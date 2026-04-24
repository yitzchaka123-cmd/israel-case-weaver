// Shared AI router. Handles three provider routes for chat completions and one
// helper for image generation.
//
// Chat-completion model id prefixes:
//   "openai/<id>"          → api.openai.com using OpenAi secret
//   "anthropic/<id>"       → api.anthropic.com using ANTHROPIC_API_KEY
//   "gemini-direct/<id>"   → generativelanguage.googleapis.com using GEMINI_API_KEY
//   anything else (incl. "google/...", "openai/..." when no key, etc.) → Lovable AI Gateway
//
// For Anthropic and Gemini-direct we translate request + response to/from
// OpenAI-compatible shapes so callers don't need provider-specific code.
//
// Image generation:
//   generateImage({ prompt, model, aspect }) returns { bytes, mime }.
//   Nano Banana (google/gemini-*-image*) routes through GEMINI_API_KEY direct
//   when configured, otherwise through Lovable AI Gateway.

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL_INTERNAL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_INTERNAL = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ---------- Run log helper ----------

/**
 * Resolve the calling user's id from the request's Authorization header.
 * Used by every edge function so ai_run_logs rows are attributed correctly.
 */
export async function getUserIdFromAuth(req: Request): Promise<string | null> {
  try {
    const authH = req.headers.get("Authorization") ?? "";
    const token = authH.replace(/^Bearer\s+/i, "");
    if (!token || !SUPABASE_URL_INTERNAL || !SERVICE_ROLE_INTERNAL) return null;
    const r = await fetch(`${SUPABASE_URL_INTERNAL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SERVICE_ROLE_INTERNAL,
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}


/**
 * Read the x-ai-fallback header set by chatCompletions and compute the model
 * that actually served the response. Returns null fallback when no fallback fired.
 */
export function extractFallback(
  resp: Response,
  requestedModel: string,
): { fallback: "none" | "openai-direct" | "lovable-ai"; effectiveModel: string } {
  const f = resp.headers.get("x-ai-fallback");
  if (f === "openai-direct") return { fallback: "openai-direct", effectiveModel: "openai/gpt-5.2" };
  if (f === "lovable-ai") {
    const eff = isGeminiDirectModel(requestedModel) ? toGatewayModel(requestedModel) : requestedModel;
    return { fallback: "lovable-ai", effectiveModel: eff };
  }
  return { fallback: "none", effectiveModel: requestedModel };
}

/**
 * Insert a row into ai_run_logs. Best-effort — never throws.
 */
export async function logAiRun(opts: {
  userId?: string | null;
  projectId?: string | null;
  surface: string;
  requestedModel?: string | null;
  effectiveModel?: string | null;
  fallback?: "none" | "openai-direct" | "lovable-ai";
  status?: "ok" | "error";
  latencyMs?: number;
  errorMessage?: string;
  targetId?: string | null;
  promptExcerpt?: string | null;
}): Promise<void> {
  try {
    if (!SUPABASE_URL_INTERNAL || !SERVICE_ROLE_INTERNAL) return;
    const body = {
      user_id: opts.userId ?? null,
      project_id: opts.projectId ?? null,
      surface: opts.surface,
      requested_model: opts.requestedModel ?? null,
      effective_model: opts.effectiveModel ?? null,
      fallback: opts.fallback ?? "none",
      status: opts.status ?? "ok",
      latency_ms: opts.latencyMs ?? null,
      error_message: opts.errorMessage ?? null,
      target_id: opts.targetId ?? null,
      prompt_excerpt: opts.promptExcerpt ? String(opts.promptExcerpt).slice(0, 500) : null,
    };
    await fetch(`${SUPABASE_URL_INTERNAL}/rest/v1/ai_run_logs`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_INTERNAL,
        Authorization: `Bearer ${SERVICE_ROLE_INTERNAL}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("logAiRun failed", e);
  }
}

export function isOpenAIModel(model: string): boolean {
  return typeof model === "string" && model.startsWith("openai/");
}
export function isAnthropicModel(model: string): boolean {
  return typeof model === "string" && model.startsWith("anthropic/");
}
export function isGeminiDirectModel(model: string): boolean {
  return typeof model === "string" && model.startsWith("gemini-direct/");
}

function jsonError(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- Chat completions ----------

export async function chatCompletions(body: Record<string, unknown>): Promise<Response> {
  const model = String(body.model ?? "");

  if (isOpenAIModel(model)) {
    if (!OPENAI_API_KEY) return jsonError("OpenAI API key (OpenAi secret) is not configured");
    const openaiBody = { ...body, model: model.slice("openai/".length) };
    return await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(openaiBody),
    });
  }

  if (isAnthropicModel(model)) {
    if (!ANTHROPIC_API_KEY) return jsonError("Anthropic API key (ANTHROPIC_API_KEY) is not configured");
    return await callAnthropic(body, model.slice("anthropic/".length));
  }

  if (isGeminiDirectModel(model)) {
    if (!GEMINI_API_KEY) {
      if (body.disableFallback === true) return jsonError("Google Gemini API key is not configured for strict direct generation", 401);
      // No Google key: prefer OpenAI direct fallback when available, else Lovable Gateway.
      return await fallbackFromGemini(body, model, "no-key");
    }
    const directResp = await callGeminiDirect(body, model.slice("gemini-direct/".length));
    // On quota / auth / server errors, transparently fall back
    if (!directResp.ok && shouldFallbackStatus(directResp.status)) {
      if (body.disableFallback === true) return directResp;
      console.warn(`Gemini direct ${directResp.status} for ${model} — falling back`);
      return await fallbackFromGemini(body, model, `gemini-${directResp.status}`);
    }
    return directResp;
  }

  // Default: Lovable AI Gateway
  return await callLovableGateway(body);
}

// When a gemini-direct/* call cannot be served, prefer OpenAI direct
// (openai/gpt-5.2) when the OpenAi secret is configured, otherwise fall back
// to the Lovable AI Gateway with the equivalent google/* model. Adds an
// `x-ai-fallback` response header so callers/UI can see what actually ran.
async function fallbackFromGemini(
  body: Record<string, unknown>,
  originalModel: string,
  reason: string,
): Promise<Response> {
  if (OPENAI_API_KEY) {
    const fallbackModel = "openai/gpt-5.2";
    console.warn(`Falling back from ${originalModel} → ${fallbackModel} (reason: ${reason})`);
    const openaiBody = { ...body, model: "gpt-5.2" };
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(openaiBody),
    });
    return withFallbackHeader(resp, "openai-direct");
  }
  console.warn(`Falling back from ${originalModel} → Lovable AI Gateway (reason: ${reason})`);
  const resp = await callLovableGateway({ ...body, model: toGatewayModel(originalModel) });
  return withFallbackHeader(resp, "lovable-ai");
}

async function withFallbackHeader(resp: Response, label: string): Promise<Response> {
  // Response objects from fetch have immutable headers; clone with a new Headers map.
  const buf = await resp.arrayBuffer();
  const headers = new Headers(resp.headers);
  headers.set("x-ai-fallback", label);
  return new Response(buf, { status: resp.status, statusText: resp.statusText, headers });
}

function shouldFallbackStatus(status: number): boolean {
  // 429 quota, 403 permission, 5xx server errors all warrant a fallback
  return status === 429 || status === 403 || status >= 500;
}

function toGatewayModel(directModel: string): string {
  // "gemini-direct/gemini-2.5-pro" → "google/gemini-2.5-pro"
  return "google/" + directModel.slice("gemini-direct/".length);
}

async function callLovableGateway(body: Record<string, unknown>): Promise<Response> {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function providerLabel(model: string): string {
  if (isOpenAIModel(model)) return "openai-direct";
  if (isAnthropicModel(model)) return "anthropic-direct";
  if (isGeminiDirectModel(model)) return "gemini-direct";
  return "lovable-ai";
}

// ---------- Anthropic translation ----------

interface IncomingMsg {
  role: string;
  content?: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

async function callAnthropic(body: Record<string, unknown>, model: string): Promise<Response> {
  const messagesIn = (body.messages as IncomingMsg[]) ?? [];
  let systemText = "";
  const messagesOut: Array<Record<string, unknown>> = [];

  for (const m of messagesIn) {
    if (m.role === "system") {
      systemText += (systemText ? "\n\n" : "") + (typeof m.content === "string" ? m.content : "");
      continue;
    }
    if (m.role === "tool") {
      // Carry tool result back as a user "tool_result" content block.
      messagesOut.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }],
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const blocks: Array<Record<string, unknown>> = [];
      const text = typeof m.content === "string" ? m.content : "";
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.tool_calls) {
        let input: unknown = {};
        try { input = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      messagesOut.push({ role: "assistant", content: blocks });
      continue;
    }
    messagesOut.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    });
  }

  const anthropicBody: Record<string, unknown> = {
    model,
    max_tokens: (body.max_tokens as number) ?? 4096,
    messages: messagesOut,
  };
  if (systemText) anthropicBody.system = systemText;
  if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;

  // Translate OpenAI-style tools → Anthropic tools, then append optional
  // Anthropic-native tools/container settings such as code execution + Skills.
  const tools = body.tools as Array<{ type: string; function: { name: string; description?: string; parameters: unknown } }> | undefined;
  const anthropicNativeTools = body.anthropicTools as Array<Record<string, unknown>> | undefined;
  if (tools?.length) {
    anthropicBody.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters,
    }));
  }
  if (anthropicNativeTools?.length) {
    anthropicBody.tools = [...((anthropicBody.tools as Array<Record<string, unknown>> | undefined) ?? []), ...anthropicNativeTools];
  }
  if (body.anthropicContainer) anthropicBody.container = body.anthropicContainer;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      ...(body.anthropicBeta ? { "anthropic-beta": String(body.anthropicBeta) } : {}),
    },
    body: JSON.stringify(anthropicBody),
  });

  if (!resp.ok) {
    // Pass through status so callers can show "Anthropic credits/key issue".
    return resp;
  }

  const data = await resp.json();
  // Translate response → OpenAI chat-completions shape
  let textOut = "";
  const toolCallsOut: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  for (const block of (data.content ?? []) as Array<Record<string, unknown>>) {
    if (block.type === "text") textOut += String(block.text ?? "");
    if (block.type === "tool_use") {
      toolCallsOut.push({
        id: String(block.id),
        type: "function",
        function: { name: String(block.name), arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const translated = {
    id: data.id,
    model: `anthropic/${data.model ?? model}`,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: textOut,
        ...(toolCallsOut.length ? { tool_calls: toolCallsOut } : {}),
      },
      finish_reason: data.stop_reason ?? "stop",
    }],
    usage: data.usage,
  };
  return new Response(JSON.stringify(translated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- Gemini direct translation ----------

async function callGeminiDirect(body: Record<string, unknown>, model: string): Promise<Response> {
  const messagesIn = (body.messages as IncomingMsg[]) ?? [];
  let systemText = "";
  const contents: Array<Record<string, unknown>> = [];
  for (const m of messagesIn) {
    if (m.role === "system") {
      systemText += (systemText ? "\n\n" : "") + (typeof m.content === "string" ? m.content : "");
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    });
  }

  const geminiBody: Record<string, unknown> = { contents };
  if (systemText) geminiBody.systemInstruction = { parts: [{ text: systemText }] };
  if (body.temperature !== undefined || body.max_tokens !== undefined) {
    geminiBody.generationConfig = {
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.max_tokens !== undefined ? { maxOutputTokens: body.max_tokens } : {}),
    };
  }
  // Note: Gemini direct tool-calling has a different shape; we deliberately
  // skip translating tools here because our tool-using flows (assistant-chat)
  // use OpenAI/Anthropic/Lovable-gateway. Pick those for tool work.

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody),
  });
  if (!resp.ok) return resp;

  const data = await resp.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");

  const translated = {
    model: `gemini-direct/${model}`,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: data.candidates?.[0]?.finishReason ?? "stop",
    }],
    usage: data.usageMetadata,
  };
  return new Response(JSON.stringify(translated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- Image generation (Nano Banana / Gemini image models) ----------

export interface ImageResult { bytes: Uint8Array; mime: string; provider: "gemini-direct" | "lovable-ai"; }

/**
 * Generate an image with a Gemini-family image model
 * (e.g. google/gemini-2.5-flash-image, google/gemini-3.1-flash-image-preview,
 * google/gemini-3-pro-image-preview).
 *
 * Routes directly to Google when GEMINI_API_KEY is set. The model id you pass
 * here is the gateway-style id; the Google direct call strips the "google/"
 * prefix automatically. No Lovable fallback is used for document assets.
 */
export async function generateImage(opts: { prompt: string; model: string }): Promise<ImageResult> {
  const { prompt, model } = opts;

  // Prefer direct Google when key configured.
  if (GEMINI_API_KEY) {
    const directModel = model.startsWith("google/") ? model.slice("google/".length) : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(directModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new ImageGenError(`Gemini direct image error ${resp.status}: ${t}`, resp.status, "gemini-direct");
    } else {
      const data = await resp.json();
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data);
      if (!inline?.inlineData?.data) {
        throw new ImageGenError("No image returned (Gemini direct)", 500, "gemini-direct");
      }
      return {
        bytes: Uint8Array.from(atob(inline.inlineData.data), (c) => c.charCodeAt(0)),
        mime: inline.inlineData.mimeType ?? "image/png",
        provider: "gemini-direct",
      };
    }
  }

  throw new ImageGenError("Google Gemini API key is not configured for direct image generation. Switch image generation to ChatGPT Image or configure Gemini Direct.", 401, "gemini-direct");
}

export class ImageGenError extends Error {
  status: number;
  provider: "gemini-direct" | "lovable-ai";
  constructor(msg: string, status: number, provider: "gemini-direct" | "lovable-ai") {
    super(msg);
    this.status = status;
    this.provider = provider;
  }
}

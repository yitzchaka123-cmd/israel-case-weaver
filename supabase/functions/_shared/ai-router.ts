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

// ---------- Reasoning / thinking ----------

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type ReasoningSegment = { type: "thinking" | "summary"; text: string };
// Coerces "xhigh" into "high" for providers that don't recognise the extended tier.
function effortForProvider(effort: ReasoningEffort): "low" | "medium" | "high" {
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  if (effort === "xhigh") return "high";
  return "medium";
}

/**
 * Whether the given provider-prefixed model id is known to support
 * extended-thinking / reasoning. Used both to gate UI affordances and to
 * decide whether to inject provider-specific reasoning request params.
 */
export function modelSupportsThinking(model: string): boolean {
  if (!model) return false;
  // Anthropic Claude 4+ family supports interleaved thinking.
  if (model.startsWith("anthropic/")) {
    return /claude-(sonnet|opus|haiku)-4/i.test(model);
  }
  // OpenAI gpt-5 family supports the reasoning parameter.
  if (model.startsWith("openai/")) {
    return /^openai\/gpt-5/i.test(model);
  }
  // Gemini 2.5 / 3 (direct or via Lovable Gateway) supports thinking.
  // Flash-Lite is excluded — it explicitly disables thinking.
  if (model.startsWith("gemini-direct/") || model.startsWith("google/")) {
    if (/flash-lite/i.test(model)) return false;
    return /(gemini-2\.5|gemini-3)/i.test(model);
  }
  return false;
}

function thinkingBudgetForEffort(effort: ReasoningEffort): number {
  switch (effort) {
    case "low": return 1024;
    case "high": return 8192;
    case "xhigh": return 16384;
    case "medium":
    default: return 4096;
  }
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

  // Caller-supplied reasoning effort. Default "medium" when the model supports
  // thinking and no override is passed; "none" to disable. We strip our custom
  // `reasoningEffort` field before forwarding to providers.
  const rawEffort = (body.reasoningEffort as ReasoningEffort | undefined) ?? "medium";
  const effort: ReasoningEffort = rawEffort;
  const wantsThinking = effort !== "none" && modelSupportsThinking(model);
  const downstream: Record<string, unknown> = { ...body };
  delete downstream.reasoningEffort;

  if (isOpenAIModel(model)) {
    if (!OPENAI_API_KEY) return jsonError("OpenAI API key (OpenAi secret) is not configured");
    const shortModel = model.slice("openai/".length);
    // When thinking is wanted, use the Responses API — chat-completions silently
    // discards reasoning summaries for gpt-5.
    if (wantsThinking) {
      return await callOpenAIResponses(downstream, shortModel, effort);
    }
    const openaiBody: Record<string, unknown> = { ...downstream, model: shortModel };
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(openaiBody),
    });
    return resp;
  }

  if (isAnthropicModel(model)) {
    if (!ANTHROPIC_API_KEY) return jsonError("Anthropic API key (ANTHROPIC_API_KEY) is not configured");
    return await callAnthropic(downstream, model.slice("anthropic/".length), wantsThinking ? effort : "none");
  }

  if (isGeminiDirectModel(model)) {
    if (!GEMINI_API_KEY) {
      if (downstream.disableFallback === true) return jsonError("Google Gemini API key is not configured for strict direct generation", 401);
      // No Google key: prefer OpenAI direct fallback when available, else Lovable Gateway.
      return await fallbackFromGemini(downstream, model, "no-key", wantsThinking ? effort : "none");
    }
    const directResp = await callGeminiDirect(downstream, model.slice("gemini-direct/".length), wantsThinking ? effort : "none");
    // On quota / auth / server errors, transparently fall back
    if (!directResp.ok && shouldFallbackStatus(directResp.status)) {
      if (downstream.disableFallback === true) return directResp;
      console.warn(`Gemini direct ${directResp.status} for ${model} — falling back`);
      return await fallbackFromGemini(downstream, model, `gemini-${directResp.status}`, wantsThinking ? effort : "none");
    }
    return directResp;
  }

  // Default: Lovable AI Gateway
  const gatewayBody: Record<string, unknown> = { ...downstream };
  if (wantsThinking && gatewayBody.reasoning === undefined) {
    gatewayBody.reasoning = { effort: effortForProvider(effort) };
  }
  const resp = await callLovableGateway(gatewayBody);
  return wantsThinking ? await normalizeOpenAIShape(resp, model) : resp;
}

// OpenAI / Lovable Gateway already return chat-completions shape. We just
// normalize any reasoning-bearing fields to a stable `message.reasoning`
// array of { type, text } so callers don't need to know about provider quirks.
async function normalizeOpenAIShape(resp: Response, sourceLabel?: string): Promise<Response> {
  if (!resp.ok) return resp;
  try {
    const data = await resp.json();
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (msg) {
      const segments = extractReasoningFromMessage(msg);
      // Some gateways place reasoning as a sibling of `message` instead of inside it.
      if (segments.length === 0 && choice.reasoning) {
        const sib = extractReasoningFromMessage({ reasoning: choice.reasoning });
        if (sib.length) segments.push(...sib);
      }
      if (segments.length > 0) msg.reasoning = segments;
      console.log(`[ai-router] normalizeOpenAIShape ${sourceLabel ?? "?"}: extracted ${segments.length} reasoning segment(s)`);
    }
    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: { ...Object.fromEntries(resp.headers), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.warn("normalizeOpenAIShape failed", e);
    return resp;
  }
}

function extractReasoningFromMessage(msg: Record<string, unknown>): ReasoningSegment[] {
  const out: ReasoningSegment[] = [];
  // Common chat-completions reasoning shapes seen across providers/gateways.
  const candidates: Array<{ value: unknown; type: ReasoningSegment["type"] }> = [
    { value: msg.reasoning_content, type: "thinking" },
    { value: msg.reasoning, type: "summary" },
    { value: (msg as { reasoning_details?: unknown }).reasoning_details, type: "summary" },
    { value: (msg as { thinking?: unknown }).thinking, type: "thinking" },
  ];
  for (const c of candidates) {
    if (typeof c.value === "string" && c.value.trim()) {
      out.push({ type: c.type, text: c.value });
    } else if (Array.isArray(c.value)) {
      for (const item of c.value) {
        if (typeof item === "string" && item.trim()) {
          out.push({ type: c.type, text: item });
        } else if (item && typeof item === "object") {
          const obj = item as { text?: string; content?: string; summary?: string; type?: string };
          // OpenAI Responses-style: { type: "summary_text", text } or { type: "reasoning", summary: [...] }
          if (Array.isArray((item as { summary?: unknown }).summary)) {
            for (const s of (item as { summary: Array<{ text?: string }> }).summary) {
              if (typeof s?.text === "string" && s.text.trim()) out.push({ type: c.type, text: s.text });
            }
            continue;
          }
          const t = obj.text ?? obj.content ?? obj.summary;
          if (typeof t === "string" && t.trim()) out.push({ type: c.type, text: t });
        }
      }
    }
  }
  // Some providers ship reasoning embedded inside message.content as content parts
  // of type "reasoning" / "thought". Scan for those too.
  if (Array.isArray(msg.content)) {
    for (const part of msg.content as Array<Record<string, unknown>>) {
      const ptype = String(part?.type ?? "");
      if (ptype === "reasoning" || ptype === "thought" || ptype === "thinking") {
        const t = String(part.text ?? part.content ?? "").trim();
        if (t) out.push({ type: ptype === "reasoning" ? "summary" : "thinking", text: t });
      }
    }
  }
  // Don't leak the raw fields back to UI alongside the normalized array.
  delete (msg as Record<string, unknown>).reasoning_content;
  delete (msg as Record<string, unknown>).reasoning_details;
  return out;
}

// ---------- OpenAI Responses API (for gpt-5 reasoning capture) ----------

interface OAIToolDecl { type: string; function: { name: string; description?: string; parameters: unknown } }

async function callOpenAIResponses(
  body: Record<string, unknown>,
  model: string,
  effort: ReasoningEffort,
): Promise<Response> {
  // Translate chat-completions → Responses API input shape.
  const messagesIn = (body.messages as IncomingMsg[]) ?? [];
  const input: Array<Record<string, unknown>> = [];
  for (const m of messagesIn) {
    if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const text = typeof m.content === "string" ? m.content : "";
      if (text) input.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const tc of m.tool_calls) {
        input.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "{}" });
      }
      continue;
    }
    const role = m.role === "system" ? "system" : (m.role === "assistant" ? "assistant" : "user");
    const partType = role === "assistant" ? "output_text" : "input_text";
    input.push({ role, content: [{ type: partType, text: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "") }] });
  }

  const reqBody: Record<string, unknown> = {
    model,
    input,
    reasoning: { effort: effortForProvider(effort), summary: "auto" },
    store: false,
  };
  const tools = body.tools as OAIToolDecl[] | undefined;
  if (tools?.length) {
    reqBody.tools = tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description ?? "",
      parameters: t.function.parameters,
    }));
  }
  if (body.max_tokens !== undefined) reqBody.max_output_tokens = body.max_tokens;

  console.log(`[ai-router] openai-responses: model=${model} effort=${effort} tools=${tools?.length ?? 0} msgs=${input.length}`);
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error("[ai-router] openai-responses error", resp.status, t.slice(0, 500));
    return new Response(t, { status: resp.status, headers: { "Content-Type": "application/json" } });
  }
  const data = await resp.json();
  // Translate Responses output → chat-completions message shape.
  let textOut = "";
  const reasoningOut: ReasoningSegment[] = [];
  const toolCallsOut: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  for (const item of (data.output ?? []) as Array<Record<string, unknown>>) {
    const itype = String(item.type ?? "");
    if (itype === "message") {
      for (const c of (item.content as Array<Record<string, unknown>> | undefined) ?? []) {
        if (String(c.type ?? "").includes("text")) textOut += String(c.text ?? "");
      }
    } else if (itype === "reasoning") {
      const summary = (item.summary as Array<Record<string, unknown>> | undefined) ?? [];
      for (const s of summary) {
        const t = String(s.text ?? "").trim();
        if (t) reasoningOut.push({ type: "summary", text: t });
      }
    } else if (itype === "function_call") {
      toolCallsOut.push({
        id: String(item.call_id ?? item.id ?? crypto.randomUUID()),
        type: "function",
        function: { name: String(item.name ?? ""), arguments: String(item.arguments ?? "{}") },
      });
    }
  }
  console.log(`[ai-router] openai-responses returned: text=${textOut.length}c reasoning=${reasoningOut.length}seg tool_calls=${toolCallsOut.length}`);
  const message: Record<string, unknown> = {
    role: "assistant",
    content: textOut,
    ...(toolCallsOut.length ? { tool_calls: toolCallsOut } : {}),
    ...(reasoningOut.length ? { reasoning: reasoningOut } : {}),
  };
  const translated = {
    id: data.id,
    model: `openai/${data.model ?? model}`,
    choices: [{ index: 0, message, finish_reason: toolCallsOut.length ? "tool_calls" : "stop" }],
    usage: data.usage,
  };
  return new Response(JSON.stringify(translated), { status: 200, headers: { "Content-Type": "application/json" } });
}

// When a gemini-direct/* call cannot be served, prefer OpenAI direct
// (openai/gpt-5.2) when the OpenAi secret is configured, otherwise fall back
// to the Lovable AI Gateway with the equivalent google/* model. Adds an
// `x-ai-fallback` response header so callers/UI can see what actually ran.
async function fallbackFromGemini(
  body: Record<string, unknown>,
  originalModel: string,
  reason: string,
  effort: ReasoningEffort,
): Promise<Response> {
  const wantsThinking = effort !== "none";
  if (OPENAI_API_KEY) {
    const fallbackModel = "openai/gpt-5.2";
    console.warn(`Falling back from ${originalModel} → ${fallbackModel} (reason: ${reason})`);
    if (wantsThinking) {
      const responsesResp = await callOpenAIResponses(body, "gpt-5.2", effort);
      return withFallbackHeader(responsesResp, "openai-direct");
    }
    const openaiBody: Record<string, unknown> = { ...body, model: "gpt-5.2" };
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(openaiBody),
    });
    return withFallbackHeader(resp, "openai-direct");
  }
  console.warn(`Falling back from ${originalModel} → Lovable AI Gateway (reason: ${reason})`);
  const gatewayBody: Record<string, unknown> = { ...body, model: toGatewayModel(originalModel) };
  if (wantsThinking && gatewayBody.reasoning === undefined) gatewayBody.reasoning = { effort: effortForProvider(effort) };
  const resp = await callLovableGateway(gatewayBody);
  const normalized = wantsThinking ? await normalizeOpenAIShape(resp, "gateway-fallback") : resp;
  return withFallbackHeader(normalized, "lovable-ai");
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
  // Optional: prior thinking blocks captured from a previous Anthropic turn.
  // When the caller round-trips them, we re-emit them so interleaved-thinking
  // continuity holds across multi-round tool loops.
  thinking?: Array<{ type: "thinking" | "summary"; text: string; signature?: string }>;
}

async function callAnthropic(body: Record<string, unknown>, model: string, effort: ReasoningEffort = "none"): Promise<Response> {
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
    if (m.role === "assistant" && (m.tool_calls?.length || m.thinking?.length)) {
      const blocks: Array<Record<string, unknown>> = [];
      // Thinking blocks MUST come first when interleaved-thinking + tool_use
      // are in play (Anthropic requirement).
      if (m.thinking?.length) {
        for (const seg of m.thinking) {
          if (seg.type === "thinking" && seg.text) {
            const block: Record<string, unknown> = { type: "thinking", thinking: seg.text };
            if (seg.signature) block.signature = seg.signature;
            blocks.push(block);
          }
        }
      }
      const text = typeof m.content === "string" ? m.content : "";
      if (text) blocks.push({ type: "text", text });
      for (const tc of (m.tool_calls ?? [])) {
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

  const wantsThinking = effort !== "none";
  const thinkingBudget = thinkingBudgetForEffort(effort);
  // max_tokens MUST be > thinking budget per Anthropic docs.
  const desiredMaxTokens = (body.max_tokens as number) ?? 4096;
  const maxTokens = wantsThinking ? Math.max(desiredMaxTokens, thinkingBudget + 1024) : desiredMaxTokens;

  const anthropicBody: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: messagesOut,
  };
  if (systemText) anthropicBody.system = systemText;
  // Anthropic requires temperature=1 when thinking is enabled.
  if (wantsThinking) {
    anthropicBody.temperature = 1;
    anthropicBody.thinking = { type: "enabled", budget_tokens: thinkingBudget };
  } else if (body.temperature !== undefined) {
    anthropicBody.temperature = body.temperature;
  }

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

  // When thinking is on for Claude 4.x, opt into the interleaved-thinking beta
  // header so thinking blocks can come between tool_use blocks.
  const callerBeta = body.anthropicBeta ? String(body.anthropicBeta) : "";
  const betaParts = callerBeta ? callerBeta.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (wantsThinking && !betaParts.includes("interleaved-thinking-2025-05-14")) {
    betaParts.push("interleaved-thinking-2025-05-14");
  }
  const betaHeader = betaParts.join(",");

  console.log(`[ai-router] anthropic: model=${model} wantsThinking=${wantsThinking} budget=${thinkingBudget} beta="${betaHeader}" tools=${(anthropicBody.tools as unknown[] | undefined)?.length ?? 0} msgs=${messagesOut.length}`);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      ...(betaHeader ? { "anthropic-beta": betaHeader } : {}),
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
  const reasoningOut: ReasoningSegment[] = [];
  // Capture thinking blocks with their signatures so callers can round-trip
  // them on subsequent tool-loop rounds (Anthropic requirement for
  // interleaved-thinking continuity).
  const thinkingBlocksOut: Array<{ type: "thinking"; text: string; signature?: string }> = [];
  const blockTypesSeen: Record<string, number> = {};
  for (const block of (data.content ?? []) as Array<Record<string, unknown>>) {
    const btype = String(block.type ?? "");
    blockTypesSeen[btype] = (blockTypesSeen[btype] ?? 0) + 1;
    if (btype === "text") textOut += String(block.text ?? "");
    else if (btype === "thinking") {
      const t = String(block.thinking ?? block.text ?? "").trim();
      if (t) {
        reasoningOut.push({ type: "thinking", text: t });
        thinkingBlocksOut.push({ type: "thinking", text: t, signature: block.signature ? String(block.signature) : undefined });
      }
    }
    else if (btype === "redacted_thinking") {
      reasoningOut.push({ type: "thinking", text: "[Redacted thinking — Claude flagged this internal reasoning as sensitive]" });
    }
    else if (btype === "tool_use") {
      toolCallsOut.push({
        id: String(block.id),
        type: "function",
        function: { name: String(block.name), arguments: JSON.stringify(block.input ?? {}) },
      });
    }
    else {
      console.warn(`[ai-router] anthropic: unknown block type "${btype}"`);
    }
  }
  console.log(`[ai-router] anthropic returned blocks: ${JSON.stringify(blockTypesSeen)} reasoning=${reasoningOut.length}seg`);
  const message: Record<string, unknown> = {
    role: "assistant",
    content: textOut,
    ...(toolCallsOut.length ? { tool_calls: toolCallsOut } : {}),
    ...(reasoningOut.length ? { reasoning: reasoningOut } : {}),
  };
  const translated = {
    id: data.id,
    model: `anthropic/${data.model ?? model}`,
    choices: [{ index: 0, message, finish_reason: data.stop_reason ?? "stop" }],
    usage: data.usage,
  };
  return new Response(JSON.stringify(translated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function callGeminiDirect(body: Record<string, unknown>, model: string, effort: ReasoningEffort = "none"): Promise<Response> {
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

  const wantsThinking = effort !== "none";
  const generationConfig: Record<string, unknown> = {};
  if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
  if (body.max_tokens !== undefined) generationConfig.maxOutputTokens = body.max_tokens;
  if (wantsThinking) {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: thinkingBudgetForEffort(effort),
    };
  }

  const geminiBody: Record<string, unknown> = { contents };
  if (systemText) geminiBody.systemInstruction = { parts: [{ text: systemText }] };
  if (Object.keys(generationConfig).length > 0) geminiBody.generationConfig = generationConfig;
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
  const parts = (data.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
  let text = "";
  const reasoningOut: ReasoningSegment[] = [];
  for (const p of parts) {
    if (typeof p.text !== "string") continue;
    if (p.thought) {
      const t = p.text.trim();
      if (t) reasoningOut.push({ type: "thinking", text: t });
    } else {
      text += p.text;
    }
  }

  const message: Record<string, unknown> = { role: "assistant", content: text };
  if (reasoningOut.length) message.reasoning = reasoningOut;

  const translated = {
    model: `gemini-direct/${model}`,
    choices: [{
      index: 0,
      message,
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

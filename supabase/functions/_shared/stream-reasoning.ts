// Streaming reasoning chat — opens an SSE connection to the right provider
// and pumps reasoning text + final content + tool calls through callbacks
// AS THEY ARRIVE. Returns a chat-completions-shaped final result so callers
// can drop it in for the existing non-streaming `chatCompletions(...)` path.
//
// Providers handled:
//   openai/gpt-5*        → /v1/responses          (event: response.*.delta)
//   anthropic/claude-*-4*→ /v1/messages           (event: content_block_delta)
//   gemini-direct/*      → :streamGenerateContent (sse parts with thought:true)
//   google/* (default)   → Lovable AI Gateway     (chat-completions SSE)
//
// All four providers are normalised to the same StreamCallbacks contract so
// the caller never needs provider-specific code.

const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

export type ReasoningSegment = { type: "thinking" | "summary"; text: string };

export interface ToolCallOut {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessageOut {
  role: "assistant";
  content: string;
  reasoning?: ReasoningSegment[];
  tool_calls?: ToolCallOut[];
  thinking_blocks?: Array<{ type: "thinking"; text: string; signature?: string }>;
}

export interface StreamFinalResult {
  ok: boolean;
  status: number;
  errorText?: string;
  message: ChatMessageOut;
  // Mirror of chatCompletions().json() shape so callers can swap in cleanly.
  raw: { choices: Array<{ index: number; message: ChatMessageOut; finish_reason: string }>; model?: string };
}

export interface StreamCallbacks {
  /** Fires for every chunk of reasoning/thinking text. */
  onReasoningDelta?: (delta: string) => void;
  /** Fires for every chunk of final assistant text. */
  onTextDelta?: (delta: string) => void;
  /** Fires once per tool call when its arguments are fully assembled. */
  onToolCall?: (call: ToolCallOut) => void;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

function effortForProvider(effort: ReasoningEffort): "low" | "medium" | "high" {
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  if (effort === "xhigh") return "high";
  return "medium";
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

interface IncomingMsg {
  role: string;
  content?: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  thinking?: Array<{ type: "thinking" | "summary"; text: string; signature?: string }>;
}

interface OAIToolDecl { type: string; function: { name: string; description?: string; parameters: unknown } }

export interface StreamReasoningInput {
  model: string;
  messages: IncomingMsg[];
  tools?: OAIToolDecl[];
  effort: ReasoningEffort;
  max_tokens?: number;
  // Anthropic-specific extras (ignored by other providers)
  anthropicTools?: Array<Record<string, unknown>>;
  anthropicContainer?: unknown;
  anthropicBeta?: string;
}

export function modelSupportsStreamingReasoning(model: string): boolean {
  if (!model) return false;
  if (model.startsWith("openai/")) return /^openai\/gpt-5/i.test(model);
  if (model.startsWith("anthropic/")) return /claude-(sonnet|opus|haiku)-4/i.test(model);
  if (model.startsWith("gemini-direct/")) {
    if (/flash-lite/i.test(model)) return false;
    return /(gemini-2\.5|gemini-3)/i.test(model);
  }
  // google/* → Lovable Gateway. Lovable Gateway speaks chat-completions SSE for all models.
  if (model.startsWith("google/")) {
    if (/flash-lite/i.test(model)) return false;
    return /(gemini-2\.5|gemini-3)/i.test(model);
  }
  return false;
}

export async function streamReasoningChat(
  input: StreamReasoningInput,
  cb: StreamCallbacks,
): Promise<StreamFinalResult> {
  const { model } = input;
  if (model.startsWith("openai/")) {
    return await streamOpenAIResponses(input, cb);
  }
  if (model.startsWith("anthropic/")) {
    return await streamAnthropic(input, cb);
  }
  if (model.startsWith("gemini-direct/")) {
    return await streamGeminiDirect(input, cb);
  }
  // Default: Lovable Gateway (chat-completions SSE)
  return await streamLovableGateway(input, cb);
}

// ---------- SSE line iterator (shared) ----------

async function* iterateSSELines(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent: string | undefined;
  let currentData: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        if (currentData.length > 0) {
          yield { event: currentEvent, data: currentData.join("\n") };
        }
        currentEvent = undefined;
        currentData = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }
  if (currentData.length > 0) {
    yield { event: currentEvent, data: currentData.join("\n") };
  }
}

// ---------- OpenAI Responses API (streaming) ----------

async function streamOpenAIResponses(input: StreamReasoningInput, cb: StreamCallbacks): Promise<StreamFinalResult> {
  if (!OPENAI_API_KEY) {
    return errorResult(401, "OpenAI API key (OpenAi secret) is not configured");
  }
  const shortModel = input.model.slice("openai/".length);
  // Translate chat-completions → Responses API input shape.
  const inputArr: Array<Record<string, unknown>> = [];
  for (const m of input.messages) {
    if (m.role === "tool") {
      inputArr.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const text = typeof m.content === "string" ? m.content : "";
      if (text) inputArr.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const tc of m.tool_calls) {
        inputArr.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "{}" });
      }
      continue;
    }
    const role = m.role === "system" ? "system" : (m.role === "assistant" ? "assistant" : "user");
    const partType = role === "assistant" ? "output_text" : "input_text";
    inputArr.push({ role, content: [{ type: partType, text: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "") }] });
  }

  const reqBody: Record<string, unknown> = {
    model: shortModel,
    input: inputArr,
    reasoning: { effort: effortForProvider(input.effort), summary: "auto" },
    store: false,
    stream: true,
  };
  if (input.tools?.length) {
    reqBody.tools = input.tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description ?? "",
      parameters: t.function.parameters,
    }));
  }
  if (input.max_tokens !== undefined) reqBody.max_output_tokens = input.max_tokens;

  console.log(`[stream-reasoning] openai-responses: model=${shortModel} effort=${input.effort} tools=${input.tools?.length ?? 0}`);
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!resp.ok || !resp.body) {
    const t = await resp.text();
    console.error("[stream-reasoning] openai-responses error", resp.status, t.slice(0, 500));
    return errorResult(resp.status, t);
  }

  let textOut = "";
  const reasoningBuckets = new Map<string, string>(); // item_id → accumulated summary text
  const reasoningOrder: string[] = [];
  const toolCalls = new Map<string, { id: string; name: string; args: string }>();
  const eventTypeCounts = new Map<string, number>();
  let terminalDiagnostic = "";
  let streamError: { status: number; message: string } | null = null;

  for await (const ev of iterateSSELines(resp.body)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(ev.data); } catch { continue; }
    const type = String(parsed.type ?? ev.event ?? "");
    eventTypeCounts.set(type, (eventTypeCounts.get(type) ?? 0) + 1);

    if (type === "response.output_text.delta") {
      const delta = String(parsed.delta ?? "");
      if (delta) {
        textOut += delta;
        cb.onTextDelta?.(delta);
      }
    } else if (type === "response.reasoning_summary_text.delta") {
      const delta = String(parsed.delta ?? "");
      const itemId = String(parsed.item_id ?? "default");
      if (delta) {
        if (!reasoningBuckets.has(itemId)) {
          reasoningBuckets.set(itemId, "");
          reasoningOrder.push(itemId);
        }
        reasoningBuckets.set(itemId, (reasoningBuckets.get(itemId) ?? "") + delta);
        cb.onReasoningDelta?.(delta);
      }
    } else if (type === "response.output_item.added") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item && String(item.type) === "function_call") {
        const id = String(item.call_id ?? item.id ?? crypto.randomUUID());
        toolCalls.set(String(item.id ?? id), { id, name: String(item.name ?? ""), args: "" });
      }
    } else if (type === "response.function_call_arguments.delta") {
      const id = String(parsed.item_id ?? "");
      const delta = String(parsed.delta ?? "");
      const tc = toolCalls.get(id);
      if (tc && delta) tc.args += delta;
    } else if (type === "response.function_call_arguments.done") {
      const id = String(parsed.item_id ?? "");
      const tc = toolCalls.get(id);
      if (tc) cb.onToolCall?.({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args || "{}" } });
    } else if (type === "error") {
      // Top-level error event from the Responses API stream.
      const err = (parsed.error ?? parsed) as { message?: string; code?: string; type?: string };
      const msg = err.message ?? "OpenAI stream error";
      const code = String(err.code ?? err.type ?? "");
      const status = /quota|insufficient|billing/i.test(msg) || code === "insufficient_quota" ? 402
        : /rate.?limit/i.test(msg) ? 429
        : /auth|key/i.test(msg) ? 401
        : 500;
      streamError = { status, message: msg };
    } else if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
      // Capture terminal status — sometimes the only place we learn that text
      // came back as an output_item we never split into deltas, or that the
      // request was rejected (e.g. unknown model, content filter).
      const response = (parsed.response ?? {}) as Record<string, unknown>;
      const status = response.status;
      const incomplete = response.incomplete_details as { reason?: string } | undefined;
      const error = response.error as { message?: string; code?: string } | undefined;
      terminalDiagnostic = `type=${type} status=${status ?? "?"} incomplete=${incomplete?.reason ?? "-"} error=${error?.message ?? "-"}`;
      if (type === "response.failed" && error?.message && !streamError) {
        const msg = error.message;
        const code = String(error.code ?? "");
        const httpStatus = /quota|insufficient|billing/i.test(msg) || code === "insufficient_quota" ? 402
          : /rate.?limit/i.test(msg) ? 429
          : /auth|key/i.test(msg) ? 401
          : 500;
        streamError = { status: httpStatus, message: msg };
      }
      // Last-resort recovery: if we never got text deltas, try to reconstruct
      // text from response.output (Responses API sometimes batches it).
      if (!textOut && Array.isArray(response.output)) {
        for (const item of response.output as Array<Record<string, unknown>>) {
          if (item.type === "message" && Array.isArray(item.content)) {
            for (const part of item.content as Array<Record<string, unknown>>) {
              if (part.type === "output_text" && typeof part.text === "string") {
                textOut += part.text;
              }
            }
          }
        }
      }
    }
  }
  if (streamError && !textOut && !toolCalls.size) {
    console.error(`[stream-reasoning] openai-responses stream failed: ${streamError.status} ${streamError.message}`);
    return errorResult(streamError.status, streamError.message);
  }
  if (!textOut && !toolCalls.size && !reasoningBuckets.size) {
    const counts = [...eventTypeCounts.entries()].map(([k, v]) => `${k}:${v}`).join(",");
    console.error(`[stream-reasoning] openai-responses EMPTY response. ${terminalDiagnostic} events=[${counts}]`);
  }

  const reasoningOut: ReasoningSegment[] = reasoningOrder
    .map((k) => reasoningBuckets.get(k) ?? "")
    .filter((t) => t.trim())
    .map((text) => ({ type: "summary" as const, text }));
  const toolCallsOut: ToolCallOut[] = [...toolCalls.values()].map((tc) => ({
    id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args || "{}" },
  }));

  const message: ChatMessageOut = {
    role: "assistant",
    content: textOut,
    ...(toolCallsOut.length ? { tool_calls: toolCallsOut } : {}),
    ...(reasoningOut.length ? { reasoning: reasoningOut } : {}),
  };
  console.log(`[stream-reasoning] openai-responses returned: text=${textOut.length}c reasoning=${reasoningOut.length}seg tool_calls=${toolCallsOut.length}`);
  return {
    ok: true, status: 200, message,
    raw: { choices: [{ index: 0, message, finish_reason: toolCallsOut.length ? "tool_calls" : "stop" }], model: `openai/${shortModel}` },
  };
}

// ---------- Anthropic Messages (streaming) ----------

async function streamAnthropic(input: StreamReasoningInput, cb: StreamCallbacks): Promise<StreamFinalResult> {
  if (!ANTHROPIC_API_KEY) return errorResult(401, "Anthropic API key (ANTHROPIC_API_KEY) is not configured");
  const model = input.model.slice("anthropic/".length);

  // Build Anthropic messages.
  let systemText = "";
  const messagesOut: Array<Record<string, unknown>> = [];
  for (const m of input.messages) {
    if (m.role === "system") {
      systemText += (systemText ? "\n\n" : "") + (typeof m.content === "string" ? m.content : "");
      continue;
    }
    if (m.role === "tool") {
      messagesOut.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
      });
      continue;
    }
    if (m.role === "assistant" && (m.tool_calls?.length || m.thinking?.length)) {
      const blocks: Array<Record<string, unknown>> = [];
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
        let inp: unknown = {};
        try { inp = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: inp });
      }
      messagesOut.push({ role: "assistant", content: blocks });
      continue;
    }
    messagesOut.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    });
  }

  const wantsThinking = input.effort !== "none";
  const thinkingBudget = thinkingBudgetForEffort(input.effort);
  const desiredMaxTokens = input.max_tokens ?? 4096;
  const maxTokens = wantsThinking ? Math.max(desiredMaxTokens, thinkingBudget + 1024) : desiredMaxTokens;

  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages: messagesOut, stream: true };
  if (systemText) body.system = systemText;
  if (wantsThinking) {
    body.temperature = 1;
    body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
  }
  if (input.tools?.length) {
    body.tools = input.tools.map((t) => ({ name: t.function.name, description: t.function.description ?? "", input_schema: t.function.parameters }));
  }
  if (input.anthropicTools?.length) {
    body.tools = [...((body.tools as Array<Record<string, unknown>> | undefined) ?? []), ...input.anthropicTools];
  }
  if (input.anthropicContainer) body.container = input.anthropicContainer;

  const callerBeta = input.anthropicBeta ?? "";
  const betaParts = callerBeta ? callerBeta.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (wantsThinking && !betaParts.includes("interleaved-thinking-2025-05-14")) {
    betaParts.push("interleaved-thinking-2025-05-14");
  }
  const betaHeader = betaParts.join(",");

  console.log(`[stream-reasoning] anthropic: model=${model} thinking=${wantsThinking} budget=${thinkingBudget}`);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      ...(betaHeader ? { "anthropic-beta": betaHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const t = await resp.text();
    console.error("[stream-reasoning] anthropic error", resp.status, t.slice(0, 500));
    return errorResult(resp.status, t);
  }

  // Track per-block-index state
  const blocks: Map<number, { type: string; text: string; signature?: string; toolName?: string; toolId?: string; toolJson?: string }> = new Map();
  let textOut = "";
  const reasoningOut: ReasoningSegment[] = [];
  const thinkingBlocksOut: Array<{ type: "thinking"; text: string; signature?: string }> = [];
  const toolCallsOut: ToolCallOut[] = [];

  for await (const ev of iterateSSELines(resp.body)) {
    if (!ev.data) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(ev.data); } catch { continue; }
    const type = String(parsed.type ?? "");

    if (type === "content_block_start") {
      const idx = Number(parsed.index ?? 0);
      const block = parsed.content_block as Record<string, unknown> | undefined;
      const btype = String(block?.type ?? "");
      if (btype === "tool_use") {
        blocks.set(idx, { type: "tool_use", text: "", toolName: String(block?.name ?? ""), toolId: String(block?.id ?? ""), toolJson: "" });
      } else {
        blocks.set(idx, { type: btype, text: "" });
      }
    } else if (type === "content_block_delta") {
      const idx = Number(parsed.index ?? 0);
      const delta = parsed.delta as Record<string, unknown> | undefined;
      const dtype = String(delta?.type ?? "");
      const blk = blocks.get(idx);
      if (!blk) continue;
      if (dtype === "thinking_delta") {
        const t = String(delta?.thinking ?? "");
        if (t) {
          blk.text += t;
          cb.onReasoningDelta?.(t);
        }
      } else if (dtype === "text_delta") {
        const t = String(delta?.text ?? "");
        if (t) {
          blk.text += t;
          cb.onTextDelta?.(t);
        }
      } else if (dtype === "input_json_delta") {
        const t = String(delta?.partial_json ?? "");
        if (t) blk.toolJson = (blk.toolJson ?? "") + t;
      } else if (dtype === "signature_delta") {
        blk.signature = (blk.signature ?? "") + String(delta?.signature ?? "");
      }
    } else if (type === "content_block_stop") {
      const idx = Number(parsed.index ?? 0);
      const blk = blocks.get(idx);
      if (!blk) continue;
      if (blk.type === "thinking" && blk.text.trim()) {
        reasoningOut.push({ type: "thinking", text: blk.text });
        thinkingBlocksOut.push({ type: "thinking", text: blk.text, signature: blk.signature });
      } else if (blk.type === "text") {
        textOut += blk.text;
      } else if (blk.type === "tool_use") {
        const tcOut: ToolCallOut = {
          id: blk.toolId ?? crypto.randomUUID(),
          type: "function",
          function: { name: blk.toolName ?? "", arguments: blk.toolJson || "{}" },
        };
        toolCallsOut.push(tcOut);
        cb.onToolCall?.(tcOut);
      } else if (blk.type === "redacted_thinking") {
        reasoningOut.push({ type: "thinking", text: "[Redacted thinking — Claude flagged this internal reasoning as sensitive]" });
      }
    }
  }

  const message: ChatMessageOut = {
    role: "assistant",
    content: textOut,
    ...(toolCallsOut.length ? { tool_calls: toolCallsOut } : {}),
    ...(reasoningOut.length ? { reasoning: reasoningOut } : {}),
    ...(thinkingBlocksOut.length ? { thinking_blocks: thinkingBlocksOut } : {}),
  };
  console.log(`[stream-reasoning] anthropic returned: text=${textOut.length}c reasoning=${reasoningOut.length}seg tool_calls=${toolCallsOut.length}`);
  return {
    ok: true, status: 200, message,
    raw: { choices: [{ index: 0, message, finish_reason: toolCallsOut.length ? "tool_calls" : "stop" }], model: `anthropic/${model}` },
  };
}

// ---------- Lovable Gateway (chat-completions SSE) ----------

async function streamLovableGateway(input: StreamReasoningInput, cb: StreamCallbacks): Promise<StreamFinalResult> {
  if (!LOVABLE_API_KEY) return errorResult(401, "Lovable API key is not configured");
  const wantsThinking = input.effort !== "none";
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: true,
  };
  if (wantsThinking) body.reasoning = { effort: effortForProvider(input.effort) };
  if (input.tools?.length) body.tools = input.tools;
  if (input.max_tokens !== undefined) body.max_tokens = input.max_tokens;

  console.log(`[stream-reasoning] lovable-gateway: model=${input.model} effort=${input.effort}`);
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const t = await resp.text();
    console.error("[stream-reasoning] lovable-gateway error", resp.status, t.slice(0, 500));
    return errorResult(resp.status, t);
  }

  let textOut = "";
  let reasoningOut = "";
  const toolBuckets: Map<number, { id: string; name: string; args: string }> = new Map();

  for await (const ev of iterateSSELines(resp.body)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(ev.data); } catch { continue; }
    const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
    if (!choice) continue;
    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) continue;

    const c = delta.content;
    if (typeof c === "string" && c) {
      textOut += c;
      cb.onTextDelta?.(c);
    }
    // Reasoning may arrive under several keys depending on provider behind the gateway
    const rCandidates: unknown[] = [
      delta.reasoning_content,
      delta.reasoning,
      (delta as { reasoning_summary?: unknown }).reasoning_summary,
    ];
    for (const r of rCandidates) {
      if (typeof r === "string" && r) {
        reasoningOut += r;
        cb.onReasoningDelta?.(r);
      } else if (r && typeof r === "object") {
        const txt = (r as { content?: string; text?: string; summary?: string }).content
          ?? (r as { text?: string }).text
          ?? (r as { summary?: string }).summary;
        if (typeof txt === "string" && txt) {
          reasoningOut += txt;
          cb.onReasoningDelta?.(txt);
        }
      }
    }

    const tcs = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (tcs?.length) {
      for (const tc of tcs) {
        const idx = Number(tc.index ?? 0);
        const fn = tc.function as Record<string, unknown> | undefined;
        const bucket = toolBuckets.get(idx) ?? { id: "", name: "", args: "" };
        if (typeof tc.id === "string" && tc.id) bucket.id = tc.id;
        if (fn) {
          if (typeof fn.name === "string" && fn.name) bucket.name = fn.name;
          if (typeof fn.arguments === "string") bucket.args += fn.arguments;
        }
        toolBuckets.set(idx, bucket);
      }
    }
  }

  const reasoningSegs: ReasoningSegment[] = reasoningOut.trim()
    ? [{ type: "summary", text: reasoningOut }]
    : [];
  const toolCallsOut: ToolCallOut[] = [...toolBuckets.values()]
    .filter((b) => b.name)
    .map((b) => ({ id: b.id || crypto.randomUUID(), type: "function", function: { name: b.name, arguments: b.args || "{}" } }));
  toolCallsOut.forEach((tc) => cb.onToolCall?.(tc));

  const message: ChatMessageOut = {
    role: "assistant",
    content: textOut,
    ...(toolCallsOut.length ? { tool_calls: toolCallsOut } : {}),
    ...(reasoningSegs.length ? { reasoning: reasoningSegs } : {}),
  };
  console.log(`[stream-reasoning] lovable-gateway returned: text=${textOut.length}c reasoning=${reasoningSegs.length}seg tool_calls=${toolCallsOut.length}`);
  return {
    ok: true, status: 200, message,
    raw: { choices: [{ index: 0, message, finish_reason: toolCallsOut.length ? "tool_calls" : "stop" }], model: input.model },
  };
}

// ---------- Gemini Direct streaming ----------

async function streamGeminiDirect(input: StreamReasoningInput, cb: StreamCallbacks): Promise<StreamFinalResult> {
  if (!GEMINI_API_KEY) return errorResult(401, "Google Gemini API key is not configured");
  const model = input.model.slice("gemini-direct/".length);

  let systemText = "";
  const contents: Array<Record<string, unknown>> = [];
  for (const m of input.messages) {
    if (m.role === "system") {
      systemText += (systemText ? "\n\n" : "") + (typeof m.content === "string" ? m.content : "");
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    });
  }

  const wantsThinking = input.effort !== "none";
  const generationConfig: Record<string, unknown> = {};
  if (input.max_tokens !== undefined) generationConfig.maxOutputTokens = input.max_tokens;
  if (wantsThinking) {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: thinkingBudgetForEffort(input.effort),
    };
  }
  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_API_KEY)}`;
  console.log(`[stream-reasoning] gemini-direct: model=${model} thinking=${wantsThinking}`);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const t = await resp.text();
    console.error("[stream-reasoning] gemini-direct error", resp.status, t.slice(0, 500));
    return errorResult(resp.status, t);
  }

  let textOut = "";
  let reasoningOut = "";
  for await (const ev of iterateSSELines(resp.body)) {
    if (!ev.data) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(ev.data); } catch { continue; }
    const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined;
    const parts = (candidates?.[0]?.content as { parts?: Array<{ text?: string; thought?: boolean }> } | undefined)?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text !== "string" || !p.text) continue;
      if (p.thought) {
        reasoningOut += p.text;
        cb.onReasoningDelta?.(p.text);
      } else {
        textOut += p.text;
        cb.onTextDelta?.(p.text);
      }
    }
  }

  const reasoningSegs: ReasoningSegment[] = reasoningOut.trim()
    ? [{ type: "thinking", text: reasoningOut }]
    : [];
  const message: ChatMessageOut = {
    role: "assistant",
    content: textOut,
    ...(reasoningSegs.length ? { reasoning: reasoningSegs } : {}),
  };
  console.log(`[stream-reasoning] gemini-direct returned: text=${textOut.length}c reasoning=${reasoningSegs.length}seg`);
  return {
    ok: true, status: 200, message,
    raw: { choices: [{ index: 0, message, finish_reason: "stop" }], model: input.model },
  };
}

// ---------- helpers ----------

function errorResult(status: number, errorText: string): StreamFinalResult {
  const message: ChatMessageOut = { role: "assistant", content: "" };
  return {
    ok: false,
    status,
    errorText,
    message,
    raw: { choices: [{ index: 0, message, finish_reason: "error" }] },
  };
}

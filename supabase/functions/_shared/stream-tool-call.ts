// Streaming helpers for chat-completions tool-call output.
//
// `streamChatCompletionsToolCall` issues a streaming chat-completions request
// to OpenAI (or the Lovable AI Gateway, which speaks the same SSE protocol)
// with a single forced tool call, and yields the function arguments as they
// arrive — chunk-by-chunk — so callers can incrementally parse JSON and
// react in real time.
//
// `extractCompletedArrayItems` is a tiny tolerant JSON walker that pulls
// out fully-closed {...} elements from a still-incomplete JSON document
// for a given top-level array key (e.g. "nodes", "edges", "envelopes"),
// without needing the whole document to be valid yet. It tracks consumed
// bytes via the returned `nextOffset` so the caller can call it again with
// a larger buffer and only get *new* items.

const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

export interface StreamArgs {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tool: {
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  };
  signal?: AbortSignal;
}

export interface StreamResult {
  ok: boolean;
  status: number;
  errorText?: string;
  // Final accumulated tool-call arguments string (full JSON). Empty if the
  // stream errored before any chunks landed.
  finalArguments: string;
  // Effective model id reported by the provider, when present.
  effectiveModel?: string;
}

/**
 * Returns true when we can use the streaming path for this model. We support
 * OpenAI direct (`openai/...`) and Lovable AI Gateway (everything that's not
 * Anthropic / Gemini-direct). Both speak chat-completions SSE.
 */
export function canStream(model: string): boolean {
  if (model.startsWith("anthropic/")) return false;
  if (model.startsWith("gemini-direct/")) return false;
  if (model.startsWith("openai/")) return !!OPENAI_API_KEY;
  // Default: Lovable AI Gateway.
  return !!LOVABLE_API_KEY;
}

/**
 * Stream a single forced tool-call from the chat-completions endpoint.
 * `onChunk` is invoked every time new bytes are appended to the tool-call
 * arguments string, with the **full accumulated** arguments so far (so the
 * caller can decide what's been parsed already).
 */
export async function streamChatCompletionsToolCall(
  args: StreamArgs,
  onChunk: (fullArgs: string) => Promise<void> | void,
): Promise<StreamResult> {
  const isOpenAI = args.model.startsWith("openai/");
  const url = isOpenAI
    ? "https://api.openai.com/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const apiKey = isOpenAI ? OPENAI_API_KEY : LOVABLE_API_KEY;
  const shortModel = isOpenAI ? args.model.slice("openai/".length) : args.model;

  const body = {
    model: shortModel,
    messages: args.messages,
    tools: [args.tool],
    tool_choice: { type: "function", function: { name: args.tool.function.name } },
    stream: true,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!resp.ok || !resp.body) {
    const t = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, errorText: t, finalArguments: "" };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let accumulatedArgs = "";
  let effectiveModel: string | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines. Process every complete event.
      let nlIdx: number;
      while ((nlIdx = sseBuffer.indexOf("\n\n")) !== -1) {
        const event = sseBuffer.slice(0, nlIdx);
        sseBuffer = sseBuffer.slice(nlIdx + 2);

        // Each event has one or more `data: ...` lines.
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const json = JSON.parse(data);
            if (json.model && !effectiveModel) effectiveModel = String(json.model);
            const choice = json?.choices?.[0];
            const delta = choice?.delta;
            const tcs = delta?.tool_calls;
            if (Array.isArray(tcs)) {
              for (const tc of tcs) {
                const argChunk = tc?.function?.arguments;
                if (typeof argChunk === "string" && argChunk.length > 0) {
                  accumulatedArgs += argChunk;
                  await onChunk(accumulatedArgs);
                }
              }
            }
          } catch {
            // Some gateways send non-JSON keep-alives; ignore.
          }
        }
      }
    }
  } catch (err) {
    return {
      ok: false,
      status: 500,
      errorText: err instanceof Error ? err.message : String(err),
      finalArguments: accumulatedArgs,
      effectiveModel,
    };
  }

  return {
    ok: true,
    status: 200,
    finalArguments: accumulatedArgs,
    effectiveModel,
  };
}

/**
 * Walk a (possibly incomplete) JSON document and return every fully-closed
 * `{...}` element belonging to the named top-level array, starting at byte
 * offset `from`. Returns the parsed elements plus the offset to resume from
 * on the next call.
 *
 * The walker is intentionally simple: it finds the array by literal key
 * search, then balances braces while honoring strings/escapes. It does NOT
 * try to parse partial elements.
 */
export function extractCompletedArrayItems<T = unknown>(
  buffer: string,
  key: string,
  from: number,
): { items: T[]; nextOffset: number } {
  const items: T[] = [];
  // Locate the array opener — only on first call (when `from` is 0 or before
  // the array). After that the caller passes back nextOffset which already
  // points inside the array.
  let cursor = from;
  if (cursor === 0) {
    const needle = `"${key}"`;
    const keyIdx = buffer.indexOf(needle);
    if (keyIdx === -1) return { items, nextOffset: 0 };
    // Skip past the colon and whitespace to find `[`.
    let i = keyIdx + needle.length;
    while (i < buffer.length && buffer[i] !== "[") {
      const ch = buffer[i];
      if (ch !== ":" && ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") {
        // Not the array we expected; bail.
        return { items, nextOffset: 0 };
      }
      i += 1;
    }
    if (i >= buffer.length) return { items, nextOffset: 0 };
    cursor = i + 1; // step past `[`
  }

  // Walk the array, collecting balanced `{...}` chunks.
  while (cursor < buffer.length) {
    // Skip whitespace, commas, and the closing `]`.
    while (cursor < buffer.length) {
      const ch = buffer[cursor];
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === ",") {
        cursor += 1;
      } else {
        break;
      }
    }
    if (cursor >= buffer.length) break;
    const ch = buffer[cursor];
    if (ch === "]") {
      // End of array. Bump past it so we don't keep re-scanning.
      return { items, nextOffset: cursor + 1 };
    }
    if (ch !== "{") {
      // Unexpected character — wait for more bytes.
      break;
    }
    // Try to find the matching `}` for this object.
    const objStart = cursor;
    let depth = 0;
    let inString = false;
    let escape = false;
    let objEnd = -1;
    for (let j = cursor; j < buffer.length; j += 1) {
      const c = buffer[j];
      if (inString) {
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inString = false; continue; }
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) { objEnd = j; break; }
      }
    }
    if (objEnd === -1) {
      // Object isn't closed yet — wait for more bytes. Keep cursor at objStart.
      return { items, nextOffset: objStart };
    }
    const slice = buffer.slice(objStart, objEnd + 1);
    try {
      items.push(JSON.parse(slice) as T);
    } catch {
      // Malformed; skip past it.
    }
    cursor = objEnd + 1;
  }

  return { items, nextOffset: cursor };
}

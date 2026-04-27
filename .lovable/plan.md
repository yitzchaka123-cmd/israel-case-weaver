## Goal

Show the model's **actual reasoning text in real time** in the "Thinking" disclosure — character by character, while the model is still working — instead of a static "Waiting for the model's reasoning to come back…" placeholder that only fills in after each round finishes.

## Why it doesn't work today

1. `assistant-chat` (and `explain-canvas-node`) call the AI router with `stream: false`. The router buffers the full response, parses reasoning at the end, and returns one big JSON blob.
2. For `openai/gpt-5*` the router uses the **non-streaming** Responses API (`/v1/responses` without `stream: true`). Reasoning summaries only arrive in the final `output[]` array.
3. The UI is realtime-driven from the `chat_messages.metadata.reasoning` column, but that column is only written **after each round completes**, so there is nothing to "stream" from the DB perspective either.
4. At `effort=low` (current default for tool rounds) gpt-5 frequently emits **zero reasoning summaries** — even at the end of the round — which is why your logs show `reasoning=0seg`.

## What this plan does

Add real provider streaming for every reasoning-capable model, and pump reasoning deltas into `chat_messages.metadata.reasoning` **as they arrive** so the existing Realtime + ThinkingDisclosure animation paints the words live.

### 1. New shared util: `_shared/stream-reasoning.ts`

A single function `streamReasoningChat({ model, messages, tools, effort, onReasoningDelta, onTextDelta, onToolCall, onDone })` that:

- Detects provider from the model id (same logic as `ai-router.ts`).
- Opens the correct **streaming** endpoint per provider:
  - **OpenAI gpt-5.x**: `POST https://api.openai.com/v1/responses` with `stream: true`, `reasoning: { effort, summary: "auto" }`. Parses SSE events `response.reasoning_summary_text.delta`, `response.output_text.delta`, `response.function_call_arguments.delta`, and the terminal `response.completed`.
  - **Anthropic Claude 4.x**: `POST /v1/messages` with `stream: true`, `thinking: { type: "enabled", budget_tokens }`, beta header `interleaved-thinking-2025-05-14`. Parses `content_block_delta` events with `delta.type === "thinking_delta"` (text) and `"input_json_delta"` (tool args).
  - **Lovable Gateway / `google/*`**: `POST https://ai.gateway.lovable.dev/v1/chat/completions` with `stream: true`, `reasoning: { effort }`. Parses chat-completions SSE — `delta.reasoning_content` / `delta.reasoning` / `delta.content` / `delta.tool_calls`.
  - **Gemini Direct (`gemini-direct/*`)**: `POST .../models/<model>:streamGenerateContent?alt=sse` with `thinkingConfig: { includeThoughts: true, thinkingBudget }`. Parses each chunk's `candidates[0].content.parts[]` — parts with `thought: true` are reasoning, others are text.
- Normalises everything into three callbacks: `onReasoningDelta(text)`, `onTextDelta(text)`, `onToolCall({ id, name, argsJson })`.
- Returns the same final shape as today's non-streaming router (text, reasoning array, tool_calls, thinking_blocks with signatures for Anthropic round-tripping) so caller logic that follows the round is unchanged.

### 2. Wire `assistant-chat` to stream reasoning into Realtime

In the round loop in `assistant-chat/index.ts`:

- Replace `chatCompletions({ stream: false, ... })` with `streamReasoningChat(...)`.
- Maintain an in-memory buffer `currentRoundReasoning = ""` and `liveSegments: ReasoningSegment[]`.
- In `onReasoningDelta(chunk)`: append to buffer, update the *last* segment of the current round (or create one), and **debounced ~150 ms** push `metadata.reasoning = [...reasoningRounds, { round, segments: liveSegments }]` to the assistant placeholder row. The existing Realtime channel + `ThinkingDisclosure` typing animation will render it word-by-word in the UI.
- In `onTextDelta(chunk)`: same debounce strategy → update `chat_messages.content` so the final reply also paints live (bonus).
- On round completion: finalise reasoning round, run tool calls, continue loop exactly as today.
- Keep existing fallback path (non-streaming `chatCompletions`) for any model that doesn't support streaming or if the stream errors mid-flight.
- Bump default `ai_reasoning_effort` floor from `"low"` → `"medium"` for tool/final rounds, because at `low` gpt-5 frequently emits zero summaries (this is OpenAI behaviour, not a bug). Add a one-line note in the Settings explainer if such copy exists.

### 3. Wire `explain-canvas-node` the same way

Smaller version of #2 — single round, no tool loop. Stream reasoning into the explanation message row so the Canvas node "Explain" panel shows live thinking.

### 4. Update `ThinkingDisclosure` placeholder copy

When `in_progress === true` and `reasoning.length === 0`, change "Waiting for the model's reasoning to come back…" to "Model is working — reasoning will appear here once it starts thinking out loud." This makes the empty state honest for low-effort models that genuinely won't emit summaries.

### 5. Surface model capability in the UI

In `useAssistantRun` / model picker, add a small "Live reasoning" badge next to models that support it (gpt-5.x, claude-sonnet/opus/haiku-4.x, gemini-2.5/3 except flash-lite). Models without it show "No live reasoning". Uses the existing `modelSupportsThinking` helper exported from `ai-router.ts`.

## Models covered

| Provider | Models with live reasoning streaming after this change |
|---|---|
| OpenAI direct | `openai/gpt-5`, `gpt-5.2`, `gpt-5.4`, `gpt-5-mini` (responses API SSE) |
| Anthropic direct | `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5` (thinking_delta SSE) |
| Lovable Gateway | `google/gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview` (chat-completions SSE with reasoning) |
| Gemini Direct | `gemini-direct/gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview` (streamGenerateContent SSE with thoughts) |
| Excluded (no thinking on these) | `gpt-5-nano`, `gemini-2.5-flash-lite`, all image models |

## Files touched

- **New**: `supabase/functions/_shared/stream-reasoning.ts` (~250 lines, four provider parsers + normaliser)
- **Edit**: `supabase/functions/assistant-chat/index.ts` (round loop, ~60-line section)
- **Edit**: `supabase/functions/explain-canvas-node/index.ts` (~20 lines)
- **Edit**: `src/features/project/AssistantSection.tsx` (placeholder copy + live `content` typing already supported)
- **Edit**: model picker component (capability badge — small)

## Out of scope

- Streaming reasoning for `generate-document`, `generate-storyboard`, `generate-marketing-copy`, etc. They are background jobs the user doesn't watch live; not worth the rewrite.
- Streaming inside the Anthropic interleaved-thinking *tool loop* — first round only is streamed; subsequent rounds after tool execution still use the non-streaming path. Can extend later if you want.

## Risk / trade-offs

- More edge-function CPU time spent holding open SSE connections (each round is a long-lived fetch). Cloudflare Workers handles this fine within the existing `EdgeRuntime.waitUntil` background pattern already used.
- ~150 ms DB-write debounce means `chat_messages` will see ~6-8 updates per second per active assistant turn. Realtime can handle this; if you notice channel saturation we can throttle to 250 ms.
- Reasoning summaries from OpenAI are **summaries**, not raw chain-of-thought. That's the most you can get — OpenAI does not expose the raw thinking tokens, by policy. Same for Gemini "thoughts". Anthropic exposes more verbose thinking blocks.
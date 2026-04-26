## Why you only see thinking *after* (and only sometimes)

I traced it. Two real bugs feeding the same symptom:

1. **Reasoning is held in memory and flushed at the very end.**
   In `supabase/functions/assistant-chat/index.ts`, `reasoningRounds` is appended after every model round, but it's only written to the `chat_messages` row in the final `update(...)` call after the run completes. Between rounds we only patch `metadata.stage` (a one-line label like `"after add_suspect…"`). So the `ThinkingDisclosure` in `AssistantSection.tsx` literally has nothing to render until the bubble flips out of `in_progress`.
2. **Many rounds return no `message.reasoning` at all.**
   We call the model with `reasoningEffort: "low"` for tool-only rounds and the project default (`"low"`) for the final round. At low effort, several models (Gemini Flash, GPT-5 mini/nano, Claude Haiku) return zero reasoning segments → `reasoningRounds` stays empty → no "Show thinking" button ever appears. That's the "only sometimes" part.

Plus the in-flight UI itself is just a spinner with one line of text, so even when reasoning *is* being collected mid-run, there's no place to show it live.

## Fix

### 1. Stream reasoning + tool trail into the placeholder row each round

In `supabase/functions/assistant-chat/index.ts`, in both the background and sync run paths (the `for (let round …)` loops around lines 1735 and 2046):

- After each round, write the **accumulated** `reasoningRounds` and the **full** `executedTools` array (not just the count) into the placeholder row's metadata, alongside the existing `stage`:
  ```ts
  void supa.from("chat_messages").update({
    metadata: {
      in_progress: true, model, stage,
      partial_tools: executedTools.length,
      tools: executedTools,                 // NEW — full receipts mid-flight
      reasoning: reasoningRounds,           // NEW — accumulated thinking so far
      stage_history: stageHistory,          // NEW — short append-only list of past stages
    },
  }).eq("id", assistantMessageId);
  ```
- Track a small `stageHistory: { at: string; label: string }[]` (push on every stage transition) so the live disclosure can show "thinking → after add_suspect → after generate_logic_flow → writing reply" as it happens.
- Also patch metadata **before** the very first model call (round 0) so the bubble flips from a blank "Thinking…" spinner into a structured live panel within ~1s of sending.

### 2. Always have *something* to show under "Thinking" — even with no reasoning summary

When the model returns no `message.reasoning`, synthesize a fallback "thinking" segment from the tool calls themselves so the disclosure is never empty:
- For each tool call in a round, push a synthetic segment like:
  ```
  { type: "thinking", text: "Calling add_suspect with {name: "Noam", role: "courier"} …" }
  ```
- That way models that don't expose reasoning still get a visible action trail, which is what users actually want to see ("what is it doing right now?").

Also bump `roundEffort` for tool rounds from hardcoded `"low"` to the project's `ai_reasoning_effort` when it's set to `"medium"` or `"high"` — currently we override the user's choice for non-final rounds, which silently suppresses thinking on those rounds.

### 3. Render a live thinking panel on the in-flight bubble

In `src/features/project/AssistantSection.tsx`:

- Replace the single-line spinner block at lines 495–513 with a **live in-flight bubble** that renders the placeholder row's metadata directly (we already find it as `inFlight`):
  - Top line: existing spinner + current `stage`.
  - Below it: a compact, **auto-expanded** `ThinkingDisclosure` showing accumulated `reasoning` segments + a `stage_history` timeline, updating in realtime via the existing `chat_messages` realtime subscription.
  - Tool receipts: render the running `tools` array using the existing `ToolReceipts` component so the user sees "✓ add_suspect", "✓ set_solution_summary", etc., appear live.
- Update the `Msg` metadata type at line 77 to include `stage_history?: { at: string; label: string }[]` and allow `tools`/`reasoning` to be present while `in_progress: true`.
- Adjust `isHiddenAssistantPlaceholder` (line 587) so we no longer hide the in-progress bubble — it should *always* be visible when in flight, since it now carries useful content. The current "hide if empty" rule was only there because the placeholder was useless mid-run.

### 4. Small UX polish

- In `ThinkingDisclosure`, when `in_progress` is true, default `open` to `true` and show a tiny pulsing dot next to "Thinking…" so it's obvious it's still streaming. When the run finishes, collapse it back (preserving user's manual toggle if they touched it).
- Keep the existing post-run "Show thinking" disclosure exactly as it is — same component, just now driven by data that arrives progressively.

## Files

- `supabase/functions/assistant-chat/index.ts` — write reasoning/tools/stage_history into the placeholder row each round in both `runBackground` and `runSync` loops; synthesize fallback thinking segments from tool calls; respect `ai_reasoning_effort` on tool rounds.
- `src/features/project/AssistantSection.tsx` — render the in-flight bubble using placeholder metadata (live `ThinkingDisclosure` + `ToolReceipts`); update `Msg` type; adjust `isHiddenAssistantPlaceholder`; auto-open disclosure while `in_progress`.

No DB migration needed — `chat_messages.metadata` is already `jsonb` and the new keys (`stage_history`, plus mid-flight `tools`/`reasoning`) just slot in.

## Out of scope (call out if you want either)

- True token-by-token streaming of the assistant's final prose. Today we use `stream: false` and write the whole reply at the end. Switching to SSE streaming for the final round is a bigger change (proxy SSE through the edge function, partial-content updates) — happy to do it as a follow-up if you want the prose itself to type out live.
- Surfacing thinking from the canvas/document generators (`generate-logic-flow`, `generate-document`, etc.). Those run in their own edge functions and would need the same pattern applied separately.
## Goal
Currently 0 of the last 15 assistant turns have any reasoning rounds saved in `chat_messages.metadata.reasoning`, across all three providers (Anthropic, OpenAI, Lovable Gateway). This plan fixes each provider's capture path so the "Show thinking" disclosure actually shows content for **OpenAI gpt-5**, **Anthropic Claude 4+**, and **Gemini 2.5/3 (via gateway)**.

---

## 1. OpenAI gpt-5 — switch to the Responses API for reasoning

**Problem**: OpenAI's standard `/v1/chat/completions` endpoint silently discards reasoning content for gpt-5. Only the `/v1/responses` endpoint surfaces `reasoning.summary` items. That's why every `openai/gpt-5.x` row has 0 rounds.

**Change in `supabase/functions/_shared/ai-router.ts`**:
- In the `isOpenAIModel` branch of `chatCompletions()`, when `wantsThinking` is true, route to `/v1/responses` instead of `/v1/chat/completions`.
- Add a new `callOpenAIResponses(body, model, effort)` helper that:
  - Translates OpenAI chat-completions request → Responses API shape (`input` array with `role`/`content` parts, `tools`, `tool_choice`, `reasoning: { effort, summary: "auto" }`).
  - Parses the response: collect `output[]` items where `type === "reasoning"` → push their `summary[].text` into `reasoning` segments; items where `type === "message"` → text content; items where `type === "function_call"` → `tool_calls`.
  - Returns a translated chat-completions-shape `Response` with `choices[0].message.reasoning` populated.
- When `wantsThinking` is false, keep the existing `/v1/chat/completions` path (cheaper, simpler).
- Tool calls: gpt-5 Responses API uses the same JSON schema for tools, so the `TOOLS` array from `assistant-chat` works unchanged after the translation.

---

## 2. Anthropic — diagnostic logs + persist thinking blocks across tool rounds

**Problem A — invisible failure mode**: We never log what Anthropic returns. If thinking is disabled by the API for any reason (e.g. budget too low, beta header conflict), we silently get 0 rounds and have no signal.

**Problem B — multi-round tool loops**: The assistant loop strips thinking blocks when re-sending prior assistant turns to Anthropic. Per Anthropic docs, when using `interleaved-thinking-2025-05-14` with tool_use, the **prior `thinking` blocks must be re-sent** in the assistant message history, otherwise subsequent rounds drop reasoning.

**Changes in `supabase/functions/_shared/ai-router.ts`**:
- Add `console.log` lines inside `callAnthropic`:
  - Before the fetch: log `model`, `wantsThinking`, `thinkingBudget`, `betaHeader`, `tools.length`.
  - After the response: log a summary of `data.content` block types (e.g. `["thinking","text","tool_use"]`) and total chars per type. Don't log the actual thinking text (size).
- When `block.type` is anything other than `text|thinking|redacted_thinking|tool_use`, log `unknown block type: <type>` so future Anthropic additions are visible.

**Changes in `supabase/functions/assistant-chat/index.ts`**:
- In both the background runner and the sync path, when the `msg` has both `tool_calls` AND `reasoning`, push the assistant turn into `convo` **with the thinking blocks attached** so the next round can re-send them. Add an optional `thinking?: ReasoningSegment[]` field to the `convo` message shape.
- In `callAnthropic`, when serializing `m.role === "assistant"` messages that include `thinking`, prepend `{ type: "thinking", thinking: <text> }` blocks **before** the `text` and `tool_use` blocks (the API requires thinking blocks to come first when interleaved-thinking is on with tool_use). For `redacted_thinking` segments we re-emit as `{ type: "redacted_thinking", data: "[redacted]" }` placeholder — Anthropic accepts this as a sentinel.

---

## 3. Lovable Gateway — broaden reasoning extraction

**Problem**: The gateway may surface reasoning under several shapes depending on the underlying model: `message.reasoning`, `message.reasoning_content`, `message.reasoning_details[]`, or even nested under `choices[0].message.content[]` as content parts of type `"reasoning"`.

**Changes in `supabase/functions/_shared/ai-router.ts`** (`extractReasoningFromMessage`):
- Add support for `msg.reasoning_details` (array of `{ type, text }` or `{ summary }`).
- Add support when `msg.content` is an array (some gateway responses): scan for items with `type === "reasoning"` and pull their `text`/`summary`.
- Add a final fallback: if the response has a top-level `data.choices[0].reasoning` (sibling of `message`), normalize that too.
- After extraction, log `[ai-router] gateway reasoning extracted N segments for model <m>` once per response so we can confirm in edge function logs.

---

## 4. Settings UI — make reasoning effort selector actually visible

The settings tweak panel is referenced in the original plan but the selector wasn't wired up in the partial implementation. Add it:

**Change in `src/features/settings/AssistantTweaksPanel.tsx`**:
- Add a "Reasoning depth" radio group: Off / Low / Medium / High / Extensive (`xhigh`).
- Wire to `projects.ai_reasoning_effort` via the existing project update mutation pattern.
- Show a small caption: "Applies when the planning model supports thinking (Claude 4+, GPT-5, Gemini 2.5/3 Pro)."
- Add `xhigh` to the DB CHECK constraint via a new migration: `alter table projects drop constraint ...; add constraint ai_reasoning_effort_check check (ai_reasoning_effort in ('none','low','medium','high','xhigh'));`
- Update `thinkingBudgetForEffort()` in `ai-router.ts` to handle `xhigh` (e.g. 16384 tokens for Anthropic).

---

## 5. UI polish — make the disclosure more discoverable

**Change in `src/features/project/AssistantSection.tsx`** (`ThinkingDisclosure`):
- Increase visual weight: render as a soft-bordered chip with `Brain` icon + "Show thinking ({totalSegments} segments, ~{tokens} tokens)" instead of just inline text.
- When expanded, render each round as a collapsible group ("Round 1", "Round 2"…) with monospace text and a subtle border.
- Show segment type badge ("thinking" vs "summary") so users understand what they're seeing differs by provider.
- Persist expanded state per message id in component state (already in place); add a copy button to copy the full reasoning text for a given message.

---

## 6. Verification

After deploy, send one message each with: Claude Sonnet 4.5, GPT-5.2, Gemini 2.5 Pro. Then run:
```sql
SELECT metadata->'effective_model' as model,
       jsonb_array_length(COALESCE(metadata->'reasoning','[]'::jsonb)) as rounds,
       created_at
FROM chat_messages WHERE role='assistant' ORDER BY created_at DESC LIMIT 5;
```
Expect `rounds >= 1` for each. Also check edge function logs for the new diagnostic lines (`[ai-router] anthropic returned blocks: ...`, `[ai-router] gateway reasoning extracted N segments`).

---

## Files touched
- `supabase/functions/_shared/ai-router.ts` — Responses API for OpenAI, diagnostic logs, thinking block round-trip serialization, broader gateway reasoning extraction, `xhigh` budget.
- `supabase/functions/assistant-chat/index.ts` — persist `thinking` in `convo` message shape and re-emit on next round.
- `src/features/settings/AssistantTweaksPanel.tsx` — new "Reasoning depth" radio.
- `src/features/project/AssistantSection.tsx` — beefier `ThinkingDisclosure` UI with per-round groups + copy button.
- New migration: extend `ai_reasoning_effort` CHECK constraint to include `xhigh`.

## Out of scope
- Live streaming of reasoning tokens (still v2 — we capture at end-of-turn).
- Backfilling reasoning into past chat messages (only new turns get it).
- Showing reasoning in the AI Run Log (separate enhancement).

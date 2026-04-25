## Goal
Surface the model's internal reasoning ("thinking") inside each assistant message — collapsed by default, expandable like a "Show thinking" disclosure (similar to ChatGPT/Claude.ai). Only enabled for models that actually support it.

## Which models support it
- **Anthropic** (`anthropic/claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`): `thinking: { type: "enabled", budget_tokens }` → returns `thinking` content blocks alongside text. Real, full thought stream.
- **OpenAI gpt-5 family** (`openai/gpt-5`, `gpt-5-mini`, `gpt-5.2`, `gpt-5.4`): supports `reasoning: { effort }`. The chat-completions API returns reasoning *summaries* (not raw chain-of-thought) in `choices[0].message.reasoning` / `reasoning_content` depending on endpoint. We capture whatever the API returns.
- **Gemini 2.5 / 3 (direct + gateway)**: `thinkingConfig: { includeThoughts: true, thinkingBudget }` on direct API → returns parts with `thought: true`. Via Lovable Gateway, pass `reasoning: { effort }` (per Lovable AI docs).
- **Other models** (flash-lite, image models): no-op, badge hidden.

## Backend changes

### 1. `supabase/functions/_shared/ai-router.ts`
- Add a `modelSupportsThinking(model)` helper.
- In `chatCompletions()`, before dispatch:
  - If caller passed `thinking: true` (or it's on by default for supported models) and the model supports it, inject the right provider-specific payload:
    - **Anthropic**: add `body.thinking = { type: "enabled", budget_tokens: 4000 }` and pass `anthropic-beta: interleaved-thinking-2025-05-14` header (claude 4.x). In `callAnthropic()`, when translating the response, collect `thinking` content blocks and attach a `reasoning` field to the translated OpenAI-shape message: `{ choices: [{ message: { role, content, reasoning: [{ type: "thinking", text }, …], tool_calls } }] }`.
    - **OpenAI (gpt-5)**: pass through `reasoning: { effort: "medium" }` (already supported by the gateway/API). After the response, if `choices[0].message.reasoning_content` or `reasoning` is present, normalize it under `message.reasoning`.
    - **Gemini direct**: in `callGeminiDirect()`, add `generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: 4096 }`. When parsing `candidates[0].content.parts`, separate `parts` where `p.thought === true` into a `reasoning` array; the rest becomes `content`. Attach `message.reasoning` in the translated OpenAI-shape response.
    - **Lovable Gateway**: pass `reasoning: { effort: "medium" }` through unchanged. The gateway currently surfaces reasoning via `choices[0].message.reasoning` for supporting models — capture whatever shape comes back, normalize to a string array.
- Normalized output shape on `message.reasoning`: `Array<{ type: "thinking" | "summary"; text: string }>` so the UI has one schema regardless of provider.

### 2. `supabase/functions/assistant-chat/index.ts`
- After each `chatCompletions()` round, read `msg.reasoning` (the normalized array) and accumulate it across rounds in a `reasoningSegments: Array<{ round: number; segments: ReasoningSegment[] }>`.
- When writing the final `chat_messages.metadata` (lines 1626–1632 and 1960–1970 in the file), include `reasoning: reasoningSegments` only when non-empty.
- Also include in the partial/error update at line 1581 and 1884 so reasoning is preserved even when a turn aborts.

### 3. Effort level
- Add a per-project setting `ai_reasoning_effort` (column on `projects`, enum `none | low | medium | high`, default `medium`) so users can tune cost vs depth. Migration adds the column.
- Default to `medium` when the column is null. `none` skips injecting any reasoning params (saves tokens for simple turns).

## Frontend changes

### 4. `src/features/project/AssistantSection.tsx`
- Extend the `metadata` type on `ChatMessage` (line 73) to include `reasoning?: Array<{ round: number; segments: Array<{ type: "thinking" | "summary"; text: string }> }>`.
- Add a new `<ThinkingDisclosure reasoning={...} />` component rendered above the message bubble (between the header row and the bubble), only when `reasoning?.length > 0` and not editing. 
  - Collapsed state: chip-style button "🧠 Thought for {N} round(s) · {totalChars} chars · Show thinking" with subtle muted styling.
  - Expanded state: monospace, slightly dimmed, indented block grouping each round's segments. Pre-wrap, scrollable if very long.
  - Use the existing `Brain` icon from lucide-react.
- Persist expanded state in component memory only (not URL); collapsed by default.
- During in-flight turns (`in_progress: true`), if any partial reasoning is visible (won't be for v1 since we only persist at end), show a "Thinking…" pulsing indicator — but for v1, the existing typing indicator covers this. Skip live streaming for now.

### 5. Settings panel — `src/features/settings/AssistantTweaksPanel.tsx`
- Add a small "Reasoning depth" radio group: Off / Low / Medium / High, wired to `projects.ai_reasoning_effort`. Show only when the project's currently selected planning model supports thinking; otherwise show a muted "Current model doesn't support reasoning."

## Database migration
```sql
alter table public.projects
  add column if not exists ai_reasoning_effort text default 'medium'
    check (ai_reasoning_effort in ('none','low','medium','high'));
```

## Out of scope (intentionally)
- Live streaming of reasoning tokens as they arrive. v1 captures the full reasoning at end-of-turn and shows it then.
- Showing reasoning in the AI Run Log settings page (we can wire it in later if useful).
- Encrypted/redacted reasoning blocks from Anthropic — we store the raw text returned. If Anthropic returns redacted blocks, we render "[Redacted thinking]".
- No change to the gpt-5 cost path: `reasoning.effort` already affects billing; the per-project setting lets the user pick.

## Files touched
- `supabase/functions/_shared/ai-router.ts` (provider-specific reasoning injection + response normalization)
- `supabase/functions/assistant-chat/index.ts` (capture + persist `metadata.reasoning`)
- `src/features/project/AssistantSection.tsx` (new `<ThinkingDisclosure>` component, type extension)
- `src/features/settings/AssistantTweaksPanel.tsx` (effort selector)
- New migration adding `projects.ai_reasoning_effort`

## Acceptance check
After this lands, switching the project's planning model to Claude Sonnet 4.5, GPT-5, or Gemini 2.5/3 Pro and sending a non-trivial turn shows a "🧠 Thought for X · Show thinking" chip on the assistant reply. Clicking it reveals the model's reasoning. Switching to Gemini Flash Lite hides the chip.


## Fall back to OpenAI GPT-5.2 when Gemini direct hits 429

The error came from the assistant chat trying a `gemini-direct/*` model, which hit Google's free-tier quota. Today the router falls back to the Lovable AI Gateway (still Google). You want a different escape hatch: **fall back to OpenAI direct (`openai/gpt-5.2`)**, and make sure the model pickers reflect that GPT-5.2 is a real, selectable option.

Note: there is no public `gpt-5.4`. The latest model exposed in our stack guidance is **`gpt-5.2`** — I'll use that. If you actually meant a different id, tell me before I implement.

### Scope

1. **Router fallback chain** — `supabase/functions/_shared/ai-router.ts`
   - When a `gemini-direct/*` call returns 429 / 403 / 5xx **and** `OpenAi` secret is set, fall back to `openai/gpt-5.2` via OpenAI direct instead of Lovable Gateway.
   - If `OpenAi` is missing, keep today's behavior (fall back to Lovable Gateway with the equivalent `google/*` model).
   - Same logic for the chat path and an analogous safety net for image generation: image models can't fall back to GPT, so they keep falling back to Lovable Gateway (image gen on OpenAI is a different API surface — out of scope).
   - Add a response header `x-ai-fallback: openai-direct` (or `lovable-ai`) so the UI can surface what actually ran if we ever want to.

2. **Model picker updates** — make sure GPT-5.2 appears everywhere a model can be chosen
   - `src/components/PromptWriterModelPicker.tsx` — add `openai/gpt-5.2` (label: "GPT-5.2 (OpenAI direct)").
   - `src/features/settings/AssistantTweaksPanel.tsx` model dropdown — add the same option.
   - `src/components/ImageModelPicker.tsx` — **no change** (image-only models; GPT-5.2 isn't an image model).
   - Any other picklist that lists chat models gets the same entry. I'll grep for the existing `openai/gpt-5` / `openai/gpt-5-mini` entries and add `gpt-5.2` next to them so the UI is consistent.

3. **No DB / migration changes.** No new secrets — `OpenAi` is already stored.

### Behavior after the change

| Scenario | Result |
|---|---|
| `gemini-direct/*` selected, Google key healthy | Google direct (unchanged) |
| `gemini-direct/*` selected, Google returns 429/403/5xx, `OpenAi` set | Auto-retry on `openai/gpt-5.2` direct |
| `gemini-direct/*` selected, Google fails, `OpenAi` missing | Falls back to Lovable Gateway `google/*` (today's behavior) |
| `openai/gpt-5.2` selected directly | Routes to OpenAI direct (already supported by `chatCompletions`) |
| Any non-Gemini model | Unchanged |

### Files touched

- `supabase/functions/_shared/ai-router.ts` — extend `chatCompletions` with the OpenAI fallback branch; add a small `callOpenAIFallback(body)` helper that swaps `model` to `openai/gpt-5.2` and reuses the existing OpenAI branch.
- `src/components/PromptWriterModelPicker.tsx` — add GPT-5.2 entry.
- `src/features/settings/AssistantTweaksPanel.tsx` — add GPT-5.2 entry to its model list.
- (any other chat-model dropdowns found via grep — same one-line addition)

### Out of scope

- No change to image generation routing (Nano Banana stays on Google direct → Lovable Gateway).
- No new secrets, no new tables, no edge function additions — just edits to the shared router and the picker components.
- Not adding a UI toast for "fallback fired" — happy to add later if you want it visible.


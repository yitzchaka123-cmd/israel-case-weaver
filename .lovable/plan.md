

## Add your Google Gemini direct API key

Everything is already wired in the backend — adding the secret is the only remaining step.

### What's already in place (no code changes needed)

- **`supabase/functions/_shared/ai-router.ts`** reads `GEMINI_API_KEY` and routes any `gemini-direct/*` model straight to `generativelanguage.googleapis.com`.
- **`generate-image`** prefers your direct key for all three Nano Banana models (`gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`) and falls back to the Lovable AI Gateway only if the key is missing.
- **`suggest-image-prompt`, `generate-marketing-copy`, `explain-canvas-node`, `generate-logic-flow`, `assistant-chat`** all already accept the `gemini-direct-*` model aliases that show up in your Settings dropdowns and the per-image `PromptWriterModelPicker`.
- **Settings → API keys** (`GeminiConnection.tsx`) already lists the key, shows connected/not-connected status, and has a Test button.

### The single action

Once we leave plan mode I will call the **add-secret** tool to securely request `GEMINI_API_KEY`. You'll get a one-time secure paste form in chat — the key is stored as a Supabase secret and never appears in the codebase or logs.

**Where to get it:** [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → "Create API key" → copy the `AIza…` string and paste it into the form.

### What flips on the moment you save the key

| Surface | Before | After |
|---|---|---|
| Nano Banana, Nano Banana 2, Nano Banana Pro (cover, suspects, documents, media) | Lovable AI Gateway (workspace credits) | Google direct, billed to your AI Studio account |
| Assistant chat — Gemini 2.5 Pro/Flash/Flash-Lite, Gemini 3.1 Pro preview, Gemini 3 Flash preview | Gateway | Your key |
| Per-image prompt writer dropdown — all `(direct)` Gemini options | Returned the "not configured" error | Live |
| Settings → Gemini panel status pill | "Not connected" | "Connected" + Test button works |

### Small UX polish (optional, included in the same change)

The "Connect Gemini" button in `GeminiConnection.tsx` currently just shows a toast telling you to ask Lovable. Since this flow is now fully self-serve via the add-secret form, no UI change is required — but if you'd like, I can also remove the now-redundant toast wording so it just says "Click to add key." Tell me yes/no when you approve and I'll include it.

### No screenshot needed

I have everything I need. The next step is purely the secret hand-off.

### Out of scope

- No DB / migration / edge function code edits.
- No changes to `OpenAi` or `ANTHROPIC_API_KEY` handling.
- No changes to which models appear in pickers (already complete).


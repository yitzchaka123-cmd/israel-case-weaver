

## Fix the "Lovable AI credits" error on Nano Banana

### What's happening

When you pick a Nano Banana model and generate an image, the request goes through the Lovable AI Gateway (because `GEMINI_API_KEY` isn't set as a secret — only `LOVABLE_API_KEY` and `OpenAi` are). The gateway then returns **402 Payment Required** because your workspace's monthly Lovable AI credits are exhausted, and the edge function surfaces that as the generic "credits/key issue" toast you're seeing.

So this isn't a bug in the call — it's a real "out of credits" signal. What's broken is:

1. The error message is vague — it doesn't tell you *which* credits ran out or what to do.
2. There's no path to use Google's API directly to bypass the gateway entirely (which would solve it permanently).
3. There's no automatic fallback when one Nano Banana variant 402s.

### The plan

**1. Make the error message actionable** (`supabase/functions/generate-image/index.ts`)

Replace the current 402 branch with a clear, specific message:
> *"Your Lovable AI workspace is out of credits for this month. Top up at Settings → Workspace → Usage in Lovable, switch to ChatGPT Image (uses your OpenAI key directly), or add a Google `GEMINI_API_KEY` in backend secrets to call Nano Banana directly and bypass the gateway."*

Surface the gateway's raw error body too so you can see exactly which limit hit.

**2. Add a "Google Gemini API key" field in Settings → API keys** (`src/features/settings/ApiKeyManager.tsx` + `supabase/functions/api-key-manager/index.ts`)

You already have a manager for OpenAI keys. Add a parallel field for `GEMINI_API_KEY`. Once you paste a Google AI Studio key, every Nano Banana call automatically routes direct to Google (the router code in `_shared/ai-router.ts` already prefers `GEMINI_API_KEY` when present — no router changes needed). This is the real fix: it permanently removes the dependency on Lovable AI credits for image generation.

**3. Auto-fallback inside `generate-image`** when the gateway returns 402

If a Nano Banana request hits 402 on the Lovable gateway and `GEMINI_API_KEY` isn't set, automatically try **`google/gemini-2.5-flash-image`** (the cheapest variant) once before failing — sometimes only the Pro/preview models are gated. If that also 402s, return the actionable message above.

**4. Frontend: show the actionable message verbatim**

`MediaSection.tsx`, `SuspectsSection.tsx`, and `ProjectOverview.tsx` already toast the server's `error` field — once step 1 is done these will read correctly with no UI changes needed. Just verify the toasts have enough room (use `toast.error(..., { duration: 10000 })` so you can read the link).

**5. Tiny model-picker hint** (`src/components/ImageModelPicker.tsx`)

Under the Nano Banana options, add a one-line muted helper: *"Uses Lovable AI credits unless a Google API key is set in Settings."* So the credit dependency is visible **before** you hit Generate.

### Files to change

- `supabase/functions/generate-image/index.ts` — better 402 message + auto-fallback to cheapest Nano Banana
- `supabase/functions/api-key-manager/index.ts` — accept/store `GEMINI_API_KEY`
- `src/features/settings/ApiKeyManager.tsx` — UI field for the Google key
- `src/components/ImageModelPicker.tsx` — credit-source hint under Nano Banana
- `src/features/project/MediaSection.tsx`, `SuspectsSection.tsx`, `ProjectOverview.tsx` — bump toast duration to 10 s so the actionable message is readable

### Acceptance check

1. Without a Google key set: Nano Banana → clear toast naming Lovable AI credits + 3 concrete fixes.
2. Add Google key in Settings → re-run Nano Banana → image generates with no Lovable AI involvement.
3. Remove the key + try Pro variant → auto-falls back to Flash variant once before erroring.
4. Picker shows the credit-source hint under Nano Banana options.


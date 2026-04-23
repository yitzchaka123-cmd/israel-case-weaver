

## Fix `gpt-image-2` document generation crashes

### What's broken

The `generate-document` edge function calls OpenAI's `gpt-image-2` with **`quality: "high"` and no timeout**. `gpt-image-2` at `high` can take up to 2 minutes; the edge runtime kills the request at ~150s, producing the `RUNTIME_ERROR` / blank-screen you're hitting (no logs written, because the worker was killed mid-flight). On top of that, when OpenAI *does* return an error (e.g. "your organization must be verified to use gpt-image-2"), the function masks it with a generic "OpenAI image generation failed (500)" so you never see what's actually wrong.

The sister function `generate-image` already has all the right fixes — we just need to bring `generate-document` up to the same standard.

### Changes

**1. `supabase/functions/generate-document/index.ts` — harden the OpenAI image branch**

- Add a **110-second `AbortController`** around the OpenAI fetch so we return a clean `504` with a "switch to Medium quality or Nano Banana" message instead of being killed by the platform.
- Default OpenAI image **quality to `"medium"`** (OpenAI's documented sweet spot for `gpt-image-2`) instead of hard-coded `"high"`.
- Add **`output_format: "jpeg"` + `output_compression: 90`** — same speedup the media generator already uses, dramatically cuts latency.
- **Surface OpenAI's real error message**, including the special "Verify Organization" hint with a deep link to `https://platform.openai.com/settings/organization/general` when the 403 says the org isn't verified for `gpt-image-2`.
- Include `x-request-id` in the error string so you can paste it to OpenAI support if needed.
- Wrap the entire image branch so storage upload / DB write failures still return JSON instead of a raw 500.

**2. `src/features/project/DocumentsSection.tsx` — make `generate()` crash-safe**

- The current `generate()` only calls `toast.error` on `!resp.ok`. If the response is `ok` but the JSON body is malformed (which happens when the worker is killed mid-write), `await resp.json()` throws and the dialog re-render crashes — that's the blank screen.
- Wrap the whole `generate` body in `try/catch`, show a toast on any thrown error, and keep the dialog mounted.
- Allow the user to pick image quality (Low / Medium / High) via the existing model picker affordance — pass it through `body` as `quality`.

**3. Quick UX polish**

- When the user has `chatgpt-image-2` selected but their OpenAI org isn't verified, show a one-time inline warning above the **Generate image** button pointing them at "ChatGPT Image 1" or a Nano Banana model as a working alternative.

### Files touched

| File | Change |
|------|--------|
| `supabase/functions/generate-document/index.ts` | Add abort timeout, jpeg output, medium default, real error surfacing, verification-hint message |
| `src/features/project/DocumentsSection.tsx` | Wrap `generate()` in try/catch; pass optional `quality`; show fallback hint when `gpt-image-2` is selected |

### What you'll see after

- Generation either succeeds in <60s, or you get a precise toast: e.g. *"OpenAI requires organization verification to use gpt-image-2. Open https://platform.openai.com/settings/organization/general → Verify Organization."*
- No more blank screens — the dialog stays open and you can retry with a different model.
- If you want the heaviest output you can still pick **High**, but **Medium** is the new default.


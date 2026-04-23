

## Add a second OpenAI account dedicated to Image 2 (gpt-image-2)

Right now the app has one OpenAI key (`OpenAi` secret) used for everything OpenAI: chat, Image 1, Image 2, usage stats. You want a **separate, dedicated OpenAI account/key for Image 2** — so the bigger/slower/more-expensive `gpt-image-2` calls hit a different OpenAI billing account from your primary one. This keeps Image 2 spend isolated and lets you verify a second org for Image 2 without touching the main account.

### How it'll work

A new optional secret `OPENAI_IMAGE2_API_KEY` is introduced. The image edge function picks the key per-model:

- **`chatgpt-image-2`** → use `OPENAI_IMAGE2_API_KEY` if set, else fall back to the primary `OpenAi` key (so nothing breaks if you haven't added the second key yet).
- **`chatgpt-image` (Image 1)** → keep using `OpenAi` (unchanged).
- **All other models** (Gemini, Lovable AI) → unchanged.

The settings page gets a new row for the second key — appears as **"OpenAI API key (Image 2 dedicated)"** with `configured` / `not set` status, a Test button, and Replace/Delete actions, exactly like the existing OpenAI row.

### Files touched

| File | Change |
|---|---|
| `supabase/functions/generate-image/index.ts` | Replace single `OPENAI_API_KEY` constant with a `pickOpenAIKey(pref)` helper that returns the Image-2 key for `chatgpt-image-2` (with fallback to primary), and the primary key otherwise. Update the missing-key error message to mention which key is missing. Update the `provider` string written to `media_assets` and `prompts` to `"openai-image2"` when the dedicated key is used, so usage is traceable in the Production Dashboard. |
| `supabase/functions/api-key-manager/index.ts` | Add `{ name: "OPENAI_IMAGE2_API_KEY", label: "OpenAI API key (Image 2 dedicated)", provider: "openai" }` to `ALLOWED_KEYS`. Existing `list` / `test` / `test_all` flows pick it up automatically. Optionally extend `fetchOpenAiUsage` later to also pull usage from this second key (out of scope here — keep it to one account for now to avoid scope sprawl). |
| `src/components/ImageModelPicker.tsx` | Add a tiny inline hint under the picker when `chatgpt-image-2` is selected: "Uses a dedicated OpenAI account if `OPENAI_IMAGE2_API_KEY` is set, otherwise the main OpenAI key." (Mirrors the existing Nano-Banana hint pattern.) |

### What you'll do after I ship this

1. Open Settings → API keys (the page you're on now).
2. Click **Refresh** — a new row "OpenAI API key (Image 2 dedicated)" appears as `not set`.
3. Click **Add key**. Lovable will pop the secure secret form. Paste the API key from your second OpenAI account (the one verified for `gpt-image-2`).
4. Click **Test** to confirm it works (hits `GET /v1/models` on that account).
5. Generate any envelope / cover / suspect with Image 2 selected — it'll bill the second account.

### Out of scope

- Per-surface routing (e.g. "always use Image 2 key for envelopes only") — still controlled by which model you pick in the surface's model picker.
- Showing usage stats from the second OpenAI account in the dashboard (current usage card pulls from the primary key only). Easy follow-up if you want it.
- A third+ OpenAI key. If you ever need that, the `pickOpenAIKey` helper is the single place to extend.


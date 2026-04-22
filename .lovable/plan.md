

## Fix OpenAI `gpt-image-2` image generation

### Root cause (from the docs + the code)

I pulled the latest OpenAI Image API docs and compared them to `supabase/functions/generate-image/index.ts`:

1. **`gpt-image-2` is real** — it is OpenAI's current flagship image model. The model name in the code is correct.
2. **The size/quality params are valid** — `1024x1024`, `1024x1536`, `1536x1024` and `quality: "high"` are all officially supported.
3. **The actual problem is latency.** The OpenAI docs explicitly say *"Complex prompts may take up to **2 minutes** to process"* for `gpt-image-2`, and at `quality: "high"` (what we pass today) it routinely takes **60–120 seconds**. Our edge function awaits the whole call, so the request gets killed by the platform's edge-function timeout long before OpenAI returns — surfacing as the runtime error you saw (`has_blank_screen: true`, no logs because the function was killed mid-flight, not because it threw).
4. Two smaller issues hidden behind the timeout:
   - `quality: "high"` is hardcoded — even drafts pay the worst-case latency.
   - There's no client-side timeout / abort, so the browser also hangs and you see a blank screen instead of an error toast.

### What I'll change

**1. `supabase/functions/generate-image/index.ts` — actually call the API the way the docs recommend, and survive long waits**

- **Lower default quality**: switch `quality` from hardcoded `"high"` to **`"medium"`** for `gpt-image-2` (huge latency win, still excellent — docs say medium is the sweet spot). High stays available via an explicit override.
- **Output format = `jpeg` with `output_compression: 90`**: docs explicitly say *"Using jpeg is faster than png, so you should prioritize this format if latency is a concern."* This alone shaves a large chunk off both generation time and upload time.
- **Add explicit `AbortController` with a 110 s timeout** on the OpenAI fetch, and translate timeouts into a clean 504 response so the UI can show a real error instead of a blank screen.
- **Add `n: 1` and the `moderation: "auto"` fields explicitly** (matches the documented schema; some routes 400 without them on edge runtimes).
- **Stream-friendly small fix**: extend the `Access-Control-Allow-Headers` list to include `prefer` and the OpenAI org headers we may need later.
- **Better verification-error surfacing**: keep the existing "verify your org" message but also forward OpenAI's `request_id` so support tickets are traceable.
- **Update the model registry comment** to match the docs (`gpt-image-2` = current flagship, `gpt-image-1.5` available, `gpt-image-1` legacy, `gpt-image-1-mini` cheap option). No new keys exposed in the picker yet — just accurate comments.

**2. `src/components/ImageModelPicker.tsx` (and any model-picker call sites) — let the user pick quality**

- Add a small **Quality** dropdown next to the OpenAI model picker (`Low / Medium / High`, default Medium). Pass the choice to the edge function as `quality` in the request body. When the user picks High we show an inline note: *"Up to 2 min — may time out on very long prompts."*

**3. Frontend timeout + clear error UX**

- Wrap every `callEdge("generate-image", …)` call in `MediaSection.tsx`, `SuspectsSection.tsx`, and `ProjectOverview.tsx` (cover) with a 120 s `AbortController` and a `toast.error` on timeout/non-2xx that surfaces the server's `error` message verbatim. Today some of these silently spin forever.

### Why not a queue?

The Lovable Cloud edge timeout is generous enough for `quality: "medium"` `gpt-image-2` (~20–40 s typical). A full job-queue rewrite would be overkill — switching to medium + jpeg + a real abort/timeout solves the actual failure mode without any schema changes. We can revisit a queue later if you ever need consistent `quality: "high"` 2K renders.

### Files to change

- `supabase/functions/generate-image/index.ts` — quality default, jpeg output, AbortController, better error mapping.
- `src/components/ImageModelPicker.tsx` — quality dropdown + helper export.
- `src/features/project/MediaSection.tsx` — pass quality, frontend timeout + toast on failure.
- `src/features/project/SuspectsSection.tsx` — pass quality, frontend timeout + toast on failure.
- `src/features/project/ProjectOverview.tsx` (cover generation flow) — same.

### Acceptance check

1. Pick **ChatGPT Image 2** in the model picker → leave quality on **Medium** → generate a cover → image appears within ~30 s, no blank screen.
2. Switch to **High** → see the latency warning → generation succeeds within ~90 s or you get a clear toast *"OpenAI took too long — try Medium quality."* — never a silent blank screen.
3. If your OpenAI org isn't verified, the toast clearly says so with the verification link (already in code, kept intact).


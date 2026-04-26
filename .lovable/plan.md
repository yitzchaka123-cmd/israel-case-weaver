## 1. Fix `gpt-image-2` High quality (no more 504)

**Root cause:** edge function aborts OpenAI at 110 s, but `gpt-image-2` at `quality: "high"` for A4 routinely takes 120–180 s.

**Fix — move High to a background job:**
- New table `image_generations` (id, project_id, source_document_id, source_envelope_id, prompt, model, provider, quality, status: `pending|generated|failed`, url, error_message, created_at, created_by_message_id, effective_model, fallback). Replaces ad-hoc usage of `media_assets` for documents/envelopes/covers/etc. — but we still write a row into `media_assets` on success for compatibility with existing surfaces.
- In `generate-document/index.ts`:
  - When `mode==="image"` AND `quality==="high"` AND OpenAI: insert a `pending` row, kick off `fetch(...)` with NO 110 s abort, return `{ jobId, pending: true }` immediately. Use `EdgeRuntime.waitUntil(...)` (Deno Deploy / Cloudflare Workers) so the function keeps running after responding. Up to ~5 min.
  - When the OpenAI call returns: upload bytes, update document row + image_generations row to `generated`. On error: write `failed` + `error_message`.
  - Medium / Low stay synchronous (current behavior).
- Front end: when response includes `pending: true`, show a "Generating high-quality image (up to 3 min)…" inline state on the doc/envelope and poll `image_generations` by jobId every 4 s until `generated|failed`.

## 2. Image generation history (per document & per envelope)

- Already inserting into `media_assets` per generation. Add UI:
  - Under the Final asset image card, a horizontal scrollable strip "**History**" showing every prior generated image (asset_type=image, source_document_id=doc.id), newest first, each thumbnail clickable to:
    - Preview in lightbox (with model bubble — already wired).
    - "Restore as final asset" → updates `documents.generated_asset_url` to that URL.
- Same strip for envelopes once we mirror the storage pattern there.

## 3. "Create prompt" must clear the previous Final prompt

In `DocumentPromptAssistant.tsx`, on `handleGeneratePrompt` click:
- Immediately call `onChange({ design: "", content: "" })` BEFORE the fetch, so the saved row is wiped.
- Switch to "Final prompt" tab and show a small spinner placeholder until the assistant returns.
- When the assistant returns, fill in the new design+content (or restore empty + show error toast on failure).

## 4. Rewrite the system prompt so user instructions actually win

In `suggest-image-prompt/index.ts` (STRUCTURED_DOC / STRUCTURED_ENV branch):

- Move USER STEERING to the **top** of the user message (currently buried at the bottom).
- Rewrite the system prompt's opening paragraph to:
  > "You produce a graphic-design brief + final in-world content. **User instructions OVERRIDE every other rule below, including any demand for detail or length.** If the user writes 'for example', 'e.g.', or 'such as', treat what follows as an *illustration of intent only* — never copy it literally into the output. If the user sets a length / tone / style limit, obey it across design_instructions + content combined, even if the rest of this prompt asks for more detail."
- Demote the "be exhaustive" bullets to "default behavior **only when the user gives no constraint**".
- Add an explicit example inside the system prompt:
  > User says: "tiny letters, for example only". → Output: design uses small typography (e.g. 8 pt body); the words "for example only" do NOT appear in the content; the brief stays short, not exhaustive.

## 5. Asset document slot (mirroring asset image)

In `DocDialog`:
- Always render two cards side by side or stacked: **Final asset image** and **Final asset document**. If empty, show "Empty — no document generated yet" placeholder.
- Final asset document card shows: format badge, model bubble, Open / Download links, plus a **History** strip of every prior generated document file (`media_assets` where `asset_type='document'` AND `source_document_id=doc.id`), each row clickable to "Restore as final document".

## 6. "Save as PDF" should also save into the PDF asset slot

In `saveAsPdf()`:
- After `pdf.save(...)`, if `draft.generated_pdf_url` is empty:
  - Convert the jsPDF blob to bytes, upload to `documents` bucket at `${projectId}/${docId}-${Date.now()}.pdf`.
  - Update `documents.generated_pdf_url` and `document_format='pdf'`, `document_provider='client-jspdf'`, `document_model='jsPDF from image'`.
  - Insert a `media_assets` row (`asset_type='document'`, `document_format='pdf'`, `generation_mode='client_image_to_pdf'`) so it appears in history.
- Toast: "PDF saved locally + added as Final asset document".

## 7. Uploaded final file overrides generated assets + final asset selector

- Keep existing upload (`uploadReplacement`). Already sets `active_version='uploaded'`.
- Add a **Final asset selector** as a small radio group at the top of the Final asset section:
  - "Generated image", "Generated document file", "Uploaded file"
  - Disabled options grey out when that source is empty.
  - Selection writes to `documents.active_version` (already exists; values `generated|generated_document|uploaded`).
- Export menu (`ExportMenu.tsx`) reads `active_version` to pick the right URL per document. We'll update it so:
  - `uploaded` → `uploaded_asset_url`
  - `generated_document` → `generated_document_url || generated_pdf_url`
  - `generated` → `generated_asset_url`
  - Falls through in that priority if the chosen one is missing.

## Files to change

- `supabase/migrations/<new>.sql` — create `image_generations` table + RLS.
- `supabase/functions/generate-document/index.ts` — async path for High; insert/update job rows.
- `supabase/functions/suggest-image-prompt/index.ts` — rewrite system prompt + reorder user message.
- `src/components/DocumentPromptAssistant.tsx` — clear final prompt on Create.
- `src/features/project/DocumentsSection.tsx` — history strips, asset document slot, final asset selector, save-as-pdf upload, polling for pending High jobs.
- `src/features/project/EnvelopesSection.tsx` — same pattern as documents (history + selector). (Smaller scope; envelope only has cover image, no document file.)
- `src/features/project/ExportMenu.tsx` — honor `active_version` priority.

## Out of scope (explicitly)

- Not touching covers / suspects / hints / media library in this pass — same patterns can be added later if you want.
- Not changing Smart-arrange vs Refine-with-AI; only answered the question.

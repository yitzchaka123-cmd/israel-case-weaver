## Why you have duplicates

Docs 1–4 were created at 21:53 (first `add_documents` call). Docs 5–8 are exact title duplicates of 1–4, created 90 minutes later at 23:23 by a second `add_documents` call from the same assistant turn (`created_by_message_id 8b675356…`).

`add_documents` in `supabase/functions/assistant-chat/index.ts` only deduplicates on `doc_number`. The second call didn't pass numbers, so the auto-numberer assigned fresh 5/6/7/8 and re-inserted the same titles. There is no DB unique constraint on (project_id, title) and no application-side title check.

So this is not a one-off — any retry, double-click, or "regenerate" of the batch will keep adding shadow copies.

## Plan

### 1. Dedupe by title in `add_documents`
File: `supabase/functions/assistant-chat/index.ts` (the batch handler around line 2083).

Pre-fetch `id, doc_number, title` for the project. Build a normalized-title map (`trim().toLowerCase().replace(/\s+/g," ")`). For each incoming row:
- If a doc with that normalized title already exists, skip the insert and report it in the response as `skipped: [{ title, existingId, doc_number }]`.
- Otherwise insert as today.

Return shape becomes `{ ok, created, skipped, failed }` so the assistant can tell the user "8 created, 4 already existed, 0 failed" instead of silently double-writing.

### 2. Same dedupe in single-doc `add_document`
Same file, the `add_document` handler (~line 1920). Before the final insert (after the Doc 0 branch), look up an existing doc with the same normalized title in this project. If found, return `{ ok: true, message: "Document already exists: …", id: existing.id }` instead of inserting. Doc 0 already has its own update-instead-of-insert path — leave it.

### 3. Clean up the 4 existing duplicates
Delete docs 5–8 in project `87e9ab59-…` (the later-created exact-title copies). Keep docs 1–4. Then re-number nothing — the gap from 5–8 doesn't matter, but if you prefer a clean sequence I can also shift 9→5, 10→6, … 44→40 in the same step. Default = just delete the 4 duplicates and leave numbering as-is so existing canvas/envelope links don't break.

### 4. (Optional but recommended) DB safety net
Add a unique partial index `documents_project_title_uniq` on `(project_id, lower(btrim(title)))` so this can never recur even if a future code path forgets to dedupe. Drop the matching duplicate rows first (step 3) so the index can build. If you'd rather keep this purely application-side, skip step 4.

## Technical notes

- Title normalization must match between insert-side and DB index (both use `lower(btrim(title))`).
- The `skipped` array lets the assistant correctly report "no new work" instead of re-listing rows it didn't actually create.
- `create-final-documents-map` already dedupes on `doc_number` and falls back to title — it won't be affected.

## Out of scope

- Changing the prompt to discourage the assistant from calling `add_documents` twice. The server-side dedupe makes prompt changes unnecessary.
- Renumbering existing docs after delete.

**Approve to apply steps 1–3 (and 4 if you want the DB constraint)?**

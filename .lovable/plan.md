## Goal

Today only **Documents** (text/image/file) and **Marketing** (single-asset batches) have real "Generate all" buttons. Suspects, Hints (image sheets), Envelope covers, and "draft text" passes are still one-by-one. This plan adds batch generators across every surface, reusing the proven progress-pill + realtime pattern so users can kick off a whole pass and walk away.

## What exists today (so we reuse, not duplicate)

- `bulk-generate-documents` edge function + `bulk_generation_jobs` table → already supports `mode: "draft" | "image" | "document" | "both"` for documents (so "draft all documents" is already covered, just needs surfacing).
- `useBatchImageProgress` + `BatchProgressPill` + `BatchProgressContext` → realtime tracker over `media_assets.status`. Used in Marketing.
- `generate-envelopes` edge function → already regenerates label/task/design for every envelope in one call (text drafts). Cover **images** are still per-envelope.
- `generate-image` edge function → used per suspect / per envelope cover / per hint sheet. Inserts a tracked row.

## What we'll add

### 1. Suspects — "Generate all portraits" + "Draft all suspects"
In `SuspectsSection.tsx` toolbar (next to "Add suspect"):
- **Generate all portraits** → for every suspect missing an active portrait (or all, with a confirm-overwrite checkbox), call `generate-image` with each suspect's stored `thumbnail_prompt` (auto-draft one via `suggest-image-prompt` if empty). Track via a new generic `useBatchImageProgress`-style hook keyed on `image_generations.id` (or reuse media_assets pattern by inserting tracked rows). Show the existing `BatchProgressPill`.
- **Draft all suspect text** → new edge function `bulk-draft-suspects` that, given `projectId`, fills `summary / role_in_case / motives / secrets / contradictions` for any suspect with empty fields, using the planning model and the project context. Concurrency 3, writes to `suspects` table, emits realtime updates. Surface a small inline progress strip (count done/total).

### 2. Hints — "Generate all hint sheets"
In `HintsSection.tsx` toolbar:
- **Generate all hint sheets** → for every stage that has a `hint_sheets` row but no `image_url` (and optionally any with a stale prompt), kick `generate-image` per stage in parallel (max 3). Reuse the existing `BatchProgressPill` keyed on `image_generations` rows.
- **Draft all stage hints** → new edge function `bulk-draft-hints` that fills missing `hints.text` for every (stage, level) slot per the playbook, using the planning model. Inline progress strip.

### 3. Envelopes — "Generate all covers"
In `EnvelopesSection.tsx` (right next to the existing "Generate all envelopes with AI" button which only does text):
- Split the current single button into a small dropdown: **Generate all → Texts only / Cover images only / Both**.
- "Cover images only" iterates every envelope, drafts a cover prompt if missing (uses the same prompt-writer the inline panel uses), then calls `generate-image` per cover with concurrency 3. Tracked via `BatchProgressPill`.

### 4. Unified "Drafting" batch (cross-surface)
At the project workspace top bar (or inside `ProductionDashboard.tsx`), add a **Draft everything missing** action that fans out:
1. `bulk-generate-documents` with `mode: "draft"` (drafts all doc text)
2. `bulk-draft-suspects`
3. `bulk-draft-hints`
4. `generate-envelopes` (text fields)

This runs them in sequence (each is itself parallelised) and surfaces a single progress pill summarising "Drafting: X / Y items". Cancel button stops all 4 phases.

### 5. Shared infrastructure
- Generalise `BatchProgressContext` from marketing-only to a project-wide provider so Suspects/Hints/Envelopes can read the same pill (one provider mounted in `ProjectWorkspace.tsx`).
- Add a tiny shared helper `runWithConcurrency(items, n, fn)` in `src/lib/` so client-side fan-outs share one limiter.

## Technical Details

**New edge functions** (both follow the same shape as `generate-envelopes`):
- `supabase/functions/bulk-draft-suspects/index.ts` — input `{ projectId, overwrite? }`, loops suspects, one chatCompletions call per suspect with the playbook + case context, writes back partial fields. Heartbeats are unnecessary because the function returns synchronously after Promise.all-with-limit, but we'll log via `ai_run_logs`.
- `supabase/functions/bulk-draft-hints/index.ts` — same pattern over `hints` rows (3 levels × N stages).

**No DB schema changes required.** All new state fits existing tables (`image_generations`, `media_assets`, `suspects`, `hints`, `bulk_generation_jobs` is reserved for the documents pipeline).

**Files to edit / add:**
- add `supabase/functions/bulk-draft-suspects/index.ts`
- add `supabase/functions/bulk-draft-hints/index.ts`
- add `src/lib/run-with-concurrency.ts`
- edit `src/features/project/SuspectsSection.tsx` (toolbar + 2 batch buttons)
- edit `src/features/project/HintsSection.tsx` (toolbar + 2 batch buttons)
- edit `src/features/project/EnvelopesSection.tsx` (split button: text/covers/both)
- edit `src/features/project/marketing/BatchProgressContext.tsx` → move/rename to `src/features/project/BatchProgressContext.tsx` and mount in `ProjectWorkspace.tsx`; update marketing imports.
- edit `src/features/project/ProjectWorkspace.tsx` (mount provider + optional global "Draft everything" button)
- edit `src/features/project/ProductionDashboard.tsx` (surface "Draft everything missing")

## Out of scope
- No new tables, no migrations, no playbook schema changes.
- Marketing batch tools stay as-is; they already work.
- Document bulk pipeline is reused, not changed.

After approval I'll implement and deploy the two new edge functions, then wire the UI.
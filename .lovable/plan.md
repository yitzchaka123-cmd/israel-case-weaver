## Goal

Make batch operations feel like one coherent assistant-driven flow:

1. User asks "generate all" (or any range) → assistant says "I'll draft them all first, then generate them one shot each."
2. Drafts are written in one batch (same as today via `add_documents` / a new draft-only bulk path).
3. Generation runs serially (1-by-1, "one shot" each) with live progress.
4. Documents tab shows a green live indicator while a job is running.
5. Notifications panel shows one entry per doc as it finishes, **with a small image thumbnail**.
6. For batch DRAFTING (no generation), same per-doc notifications appear but **without** a thumbnail.
7. When the full bulk-generate run finishes, the assistant posts a chat message acknowledging completion and prompting the next step.
8. Add a "Draft all" button on the Documents tab that triggers the same flow as the assistant.

## Changes

### 1. Edge function `bulk-generate-documents`
- Emit a `project_notifications` row **per document** as each one finishes (currently only a single summary notification is emitted at the very end).
  - `kind: "bulk_doc_done"` (success) / `"bulk_doc_failed"` (failure).
  - Title: `"✓ Doc N — <title>"` / `"⚠ Doc N — <title> failed"`.
  - Body: short status (`"Generated image + PDF"`, error message, etc.).
  - Store thumbnail URL inline in `body` as a data hint OR add a small `metadata` jsonb-style approach. Since `project_notifications` has no metadata column, encode the preview URL on a new nullable column `preview_image_url text` (migration).
  - For `mode === "draft"` runs, leave `preview_image_url` null (no thumbnail rendered).
- When the run finishes successfully (non-draft mode), insert a final `kind: "bulk_generation_done"` notification with a `starter_prompt` that asks the assistant to acknowledge progress and propose the next step (e.g. "Bulk generation finished — please review with me and tell me what to do next.").
- Force serial-by-default for the assistant's "one shot each" promise: keep `concurrency` param but default to 1 when called from the assistant. Concurrency selector in the UI dialog stays.

### 2. Migration
- `ALTER TABLE public.project_notifications ADD COLUMN preview_image_url text;`

### 3. Notifications UI (`NotificationPanel.tsx` + `useProjectNotifications.ts`)
- Extend `ProjectNotification` type with `preview_image_url: string | null`.
- In `NotificationCard`, when `preview_image_url` is set, render a 40×40 rounded thumbnail to the left of the title.
- Group consecutive `bulk_doc_done` items visually (small `+N more` collapse) — optional polish, only if simple.

### 4. Documents tab live indicator (`DocumentsSection.tsx`)
- When `jobRunning` is true, show a small green pulsing dot + "Live" label next to the "Documents" h2 (and surface in the section tab if there's a tab strip — check `ProjectWorkspace`). Already have the progress bar; add the dot near the title for at-a-glance signal.
- Add a **"Draft all"** button beside "Generate all":
  - Opens a confirm toast / small dialog: "Draft all remaining documents?"
  - Calls the same `bulk-generate-documents` edge function with `mode: "draft"`, `scope: "all_remaining"`.
  - Reuses the existing job-progress UI.

### 5. Assistant playbook (`supabase/functions/assistant-chat/index.ts` BATCH RULES + `bulk_generate_documents` tool)
- Update the assistant's prose contract: when the user asks to "generate all/any range", the assistant must:
  1. Reply with a one-line plan: "I'll first draft all of them, then generate them one shot each. Watch the Documents tab and the bell."
  2. Call `bulk_generate_documents` with `mode: "draft"` first **only if** any target docs lack `hebrew_content`. (Detect inside the tool handler — if all targets already have drafts, skip straight to generation.)
  3. Then call `bulk_generate_documents` with `mode: "both"` (image + document) for the same scope.
  - Both calls are fire-and-forget; the second is queued but the worker will pick up drafts as they're written. To keep ordering simple, chain them: pass an optional `chain_after_job_id` so the second job waits for the first to finish (worker polls until the prior job's status is `completed`/`failed` before starting). Lightweight: add a `wait_for_job_id` field on `bulk_generation_jobs` and have the worker sleep-poll up to N minutes.
- Add a new tool `acknowledge_bulk_completion` (or reuse `send_message`-style) — actually simpler: the bulk function inserts the `bulk_generation_done` notification with a `starter_prompt`; when the user clicks "Open in Assistant" the assistant naturally responds. To make it automatic without a click, add a tiny client-side effect in `ProjectWorkspace` that, when a new `bulk_generation_done` notification arrives for the active project, posts a system-style assistant message ("Bulk generation finished — N/M succeeded. Ready to move to the next step?") into the chat. Keep this in one place to avoid double-fires.

### 6. Draft-all button → assistant integration
- The "Draft all" button calls the edge function directly (no assistant turn needed) — but ALSO posts a user chat message ("Drafting all remaining documents…") so the assistant is aware in context for the next turn. Use existing `chat_messages` insert pattern.

## Technical notes

- `bulk_generation_jobs.mode` already supports `"draft"`. We need realistic per-doc notification emission inside the worker loop in `bulk-generate-documents/index.ts` (right after the success/failure branch in `runOne`).
- For thumbnail in draft mode notifications: explicitly set `preview_image_url: null`. For image/both modes: read `documents.generated_asset_url` post-success and pass it through.
- `MAX_ROUNDS` in assistant-chat is already 6 — sufficient for the "draft → then generate" two-tool sequence.
- No changes needed to `useBatchImageProgress` (that's for marketing image batches, separate flow).
- Live indicator: simple `<span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />` next to the Documents heading when `jobRunning`.

## Files to edit

- `supabase/migrations/<new>.sql` — add `preview_image_url` column
- `supabase/functions/bulk-generate-documents/index.ts` — per-doc notifications, optional `wait_for_job_id` chaining, default concurrency=1
- `supabase/functions/assistant-chat/index.ts` — update BATCH RULES prose; teach `bulk_generate_documents` tool to optionally chain a draft pass before a generate pass
- `src/features/project/notifications/useProjectNotifications.ts` — add `preview_image_url` to type
- `src/features/project/notifications/NotificationPanel.tsx` — render thumbnail
- `src/features/project/DocumentsSection.tsx` — green live dot + "Draft all" button
- `src/features/project/ProjectWorkspace.tsx` — auto-post assistant follow-up when `bulk_generation_done` notification arrives

## Out of scope

- Reworking the per-doc generation pipeline itself (`generate-document`).
- Marketing batch progress (`BatchProgressContext`) — already separate.

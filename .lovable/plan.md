## Goals

Four small, related changes to how documents flow through the assistant + Final Flow board.

---

### 1. Final Flow node colors driven by document status

Final Flow document nodes already store a status string in `canvas_nodes.data.n` (currently: `ungenerated`, `draft row created`, `image generated`, `file generated`, `finalized`). The legend lives in `STATUS_STYLE` in `src/features/project/canvas/CanvasNodeTypes.tsx`.

We will:
- Add two new explicit color buckets to `STATUS_STYLE`:
  - **Generated** (any status meaning "the document has been produced but not yet approved" — `image generated`, `file generated`, plus a new `generated` umbrella) → **blue**.
  - **Approved / final** (`finalized`, plus a new `approved`) → **green**.
- Keep `ungenerated` and `draft row created` as the existing muted/yellow tones.
- When `documents.status` flips, mirror it onto the matching Final Flow `canvas_nodes.data.n` so the board recolors live. Two write paths to update:
  1. `supabase/functions/generate-document/index.ts` — after a successful image/file write, also patch the linked final-flow node `data.n` to `"generated"` (blue).
  2. A new `approve_document` flow (see #2) — patches both `documents.status = "final"` AND the linked final-flow node `data.n = "approved"` (green).

Result: blue node = generated, green node = approved, at a glance.

---

### 2. Assistant auto-approval on "this is good, move on"

Today the assistant has `update_document` and `generate_document_assets` but no explicit "approve" tool, so docs sit at `status: "review"` forever (that's what you're seeing in the UI — `generate-document` writes `status: "review"` on success and nothing ever moves it to `final`).

We will:
- Add a new assistant tool **`approve_document`** with input `{ document_id, kind: "image" | "file" | "both" }`. It sets `documents.status = "final"`, mirrors `data.n = "approved"` on the linked final-flow node, and returns a short receipt.
- Add a behavioral rule to the assistant system prompt: when the user reacts to a just-shown image or document with a positive/move-on signal — examples: "this is good", "looks great", "perfect", "approved", "next one", "move on", "continue", "ok next", "👍", "love it" — the assistant MUST call `approve_document` for the most recently shown doc BEFORE moving on. If the same trigger applies to a standalone image (suspect, hint, cover, inline image), it calls the existing per-asset update tool to mark it approved analogously.
- Also support an explicit "approve doc N" / "approve all so far" phrasing.

Result: saying "this is good, next" actually flips the doc to final and turns its node green.

---

### 3. Visual-feel blurb when assistant presents each document

When the assistant walks the user through a freshly generated document, it currently only shows the title + body / file. We will extend the assistant system prompt for the document-presentation step so that, in addition to what it says today, it adds **one short paragraph (2–4 sentences) describing the *visual feel* of the document** — paper stock, era, color palette, typography, layout vibe, any photos/stamps/handwriting it would carry. This is a chat-only addition: the document's stored `design_instructions`, the Documents UI, and the generation pipeline are unchanged. The blurb is derived from `design_instructions` + the doc type so it stays consistent with what was actually produced.

Also: when the assistant proposes a document set (`propose_document_set`) or presents the next doc to generate, include the same kind of one-line "visual feel" hint per item so the user can picture it before approving.

---

### 4. Direct answer: can we bulk-generate all docs?

**Today: no.** `generate-document` and `generate-image` are one-shot edge functions invoked per asset. The assistant produces docs one-at-a-time via `generate_document_assets`, and the user clicks Generate per slot in the UI. There is no queue, no fan-out, no "generate all" button, and no rate-limited batch worker.

What "yes" would require (NOT in this plan — flagging only so you can decide later): a new edge function (`generate-all-documents`) that walks every doc row in `status != "final"`, enqueues image + file generation for each with a small concurrency limit (e.g. 2–3 in parallel, the rest sequential to respect Anthropic/Lovable AI rate limits), writes per-doc progress into a new `bulk_generation_jobs` row, and a UI strip on the Documents page showing live progress. Same applies to inline images. Want me to add that as a follow-up?

---

## Technical summary

- **Migration**: none required for this plan (statuses are strings; no schema change).
- **Edited files**:
  - `src/features/project/canvas/CanvasNodeTypes.tsx` — add `generated` (blue) and `approved` (green) to `STATUS_STYLE`; keep legacy keys mapping to the same colors.
  - `supabase/functions/generate-document/index.ts` — after image/file success, patch linked final-flow node `data.n = "generated"`.
  - `supabase/functions/assistant-chat/index.ts` — add `approve_document` tool definition + handler; extend system prompt with (a) auto-approval triggers and (b) "visual feel" blurb requirement during doc presentation and `propose_document_set`.
- **No UI change needed** in `DocumentsSection.tsx` — the existing `STATUSES = ["draft", "in_progress", "review", "final"]` selector still works; "final" simply now has a real path to be set.

Once you say the plan is good, I'll build it.
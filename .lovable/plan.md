## Goals

Three connected upgrades:

1. **Smart Arrange that doesn't scatter or overlap nodes** (research-backed).
2. **Batch document generation** — assistant-driven and a UI button — with a progress indicator.
3. **Suspect intake page** — assistant auto-creates a one-page police-report doc per suspect with the suspect photo as an inline image (and uses the locked anchor logic so all suspect portraits look like they came from the same world).

---

### 1. Fix Smart Arrange (no overlap, no infinite scatter)

#### What's broken today

`supabase/functions/arrange-canvas/index.ts` already does a deterministic "lanes" layout with role-aware columns. Two real problems:
- **Naive overlap resolver.** `resolveOverlaps` just nudges colliding nodes one row down without regard to others — on dense graphs it cascades nodes off-screen, which is what you're seeing as "scatter."
- **`ai-refine` mode** asks the LLM to repaint coordinates from scratch, often returning huge x/y values that explode the canvas.

#### Research — what ComfyUI / FreePik / Runway / n8n actually do

The convergent industry approach for node graphs is the **Sugiyama layered layout** (the same algorithm behind `dagre` and Eclipse `ELK`). The well-known ComfyUI extensions (`comfyui-auto-nodes-layout`, `comfyui-workflow-prettier`) and n8n's native auto-layout all use Sugiyama variants because:

1. **Layering** — assign every node a column (or row) by longest-path topological depth. Roots on the left, leaves on the right. Connected nodes are always one layer apart, so edges read as one-step arrows.
2. **Crossing reduction** — within each layer, reorder nodes (median + barycenter heuristic) to minimize edge crossings. This is the difference between "readable" and "spaghetti".
3. **Coordinate assignment** — Brandes-Köpf method: pack nodes inside a layer with a fixed minimum gap, then center each node between its parents/children to straighten edges.
4. **Disconnected components are laid out independently** and stacked — they never get scattered into the connected graph's bounding box.
5. **Bounding box is tight**: width = sum of layer widths + gaps; height = max layer height. The canvas auto-fits to this box, so the user always sees the whole graph after pressing Arrange.

ComfyUI's "Align Nodes" feature additionally **groups by node category** (loaders left, samplers middle, savers right) on top of Sugiyama — exactly the role-based lanes we already have, just stricter.

#### What we'll build

Replace the homegrown layout in `arrange-canvas` with a proper layered/Sugiyama layout (we'll port a small dagre-style implementation directly to Deno — no npm dependency needed, ~200 lines). Plus:

- **Strict no-overlap guarantee**: per-layer coordinate assignment uses a fixed-stride packer; any node placed inside a layer is shifted right by `NODE_W + GAP` from the previous one. No collisions are possible by construction (the broken `resolveOverlaps` is removed).
- **Component-aware**: disconnected subgraphs are laid out separately, then stacked vertically with a clear gap, instead of being squeezed into the same band.
- **Tight bounding box returned to the client**: `arrange-canvas` returns `{ width, height, originX, originY }` and the client calls React Flow's `fitView({ padding: 0.15 })` after applying positions, so the user immediately sees the whole graph centered.
- **Variant cycling preserved**: keep "lanes / columns / suspects / compact" buttons; they re-run Sugiyama with different role-grouping rules (lanes by `node_type`, columns rotated 90°, swimlanes by suspect, compact = chain-packed).
- **Scrap `ai-refine`** as a coordinate-rewriter. Instead, "Refine with AI" becomes: run the deterministic Sugiyama, then ask the LLM only to suggest **logical groupings** (which nodes to keep adjacent, which clusters belong together) — the LLM returns group labels, not coordinates, and we re-run the deterministic packer with those groups as lane hints. This is the only way LLM-assisted layout doesn't explode the canvas.

#### Result

Arrange always produces a **tight, readable, non-overlapping** layout that fits on screen, regardless of graph size or AI vs deterministic mode.

---

### 2. Batch document generation

#### What exists today

- `generate-document` is a single-doc edge function (text / image / file).
- The assistant calls `generate_document_assets` per-doc, sequentially, in chat.
- No queue, no progress UI, no "draft all" mode.
- Document regenerations DO already save to `media_assets` (history carousel works) ✅.
- Inline image anchor is already implemented ✅.

#### What we'll build

**a) New edge function `bulk-generate-documents`** that accepts:
```
{
  projectId: string,
  scope: "all_remaining" | "from_doc_number" | "ids",
  fromDocNumber?: number,    // for "from_doc_number"
  documentIds?: string[],    // for "ids"
  mode: "draft" | "image" | "document" | "both",  // matches generate-document modes
  documentFormat?: "pdf" | "docx",                // for document/both mode
  concurrency?: number,      // default 3, hard max 5
}
```

Implementation:
- Resolves the doc list, filters out already-final docs, then walks them with a small concurrency window (default 3) calling the existing `generate-document` internally per doc + per requested output (no logic duplicated).
- Writes a row to a new **`bulk_generation_jobs`** table for live progress: `id, project_id, scope, mode, total, completed, failed, current_doc_id, status, started_at, finished_at, error`. Each per-doc completion bumps `completed`/`failed` and updates `current_doc_id`.
- Realtime is enabled on the new table so the UI subscribes and shows live progress.
- Respects rate limits: on 429/credits errors, the worker pauses 30s and retries the failed doc up to 2 times before marking it failed and moving on.

**b) New assistant tool `bulk_generate_documents`** with the same shape. System-prompt rules:
- "Continue from here / generate the rest / produce all remaining docs" → call with `scope: "all_remaining"` and ask which output (Draft / Image / PDF / Both) via `propose_options` first.
- "Only draft all the documents" → `mode: "draft"` (writes hebrew_content for each doc but no image/file).
- "Save them all as PDFs from the image" → currently no path exists to convert an image to PDF; we'll add `mode: "image_to_pdf"` that takes each doc's existing `generated_asset_url` (image), wraps it on a single PDF page via Claude file API (the same skill pipeline that already produces PDFs), and stores the PDF in `generated_document_url`.
- "Generate up to doc 12" → `scope: "from_doc_number", fromDocNumber: <last current>` plus a `untilDocNumber` cap.

**c) UI: batch button + progress strip**

In `DocumentsSection.tsx` header, add a **"Batch generate"** dropdown button: Draft all · Generate images · Generate PDFs · Both. Selecting one spins up the bulk job and pins a sticky progress strip at the top of the documents tab:

```text
Generating PDFs · 12 / 40 · current: "#13 Autopsy Report"  [✕ cancel]
```

The strip subscribes to the `bulk_generation_jobs` row via Realtime and disappears on completion (with a toast: "40 / 40 documents generated. 0 failed."). A small bell notification fires too via the existing `project_notifications` table.

#### Carousel / anchor confirmation

Already working — every regeneration writes a new `media_assets` row with `source_document_id`, and `DocumentsSection.tsx` queries those for the image/file history strips. The locked anchor reference for inline images was added in the previous turn (`document_inline_images.anchor_reference_url`). Nothing to add here, just confirmed.

---

### 3. Suspect intake page (auto, with photo)

#### What we'll build

- New **assistant rule**: during Phase 4 document planning, when proposing the document set, the assistant decides per-case whether each suspect deserves a one-page intake/police-report document. The default is YES for any case where suspects matter (mystery, detective, espionage, crime, thriller); the assistant skips it only when the format genuinely doesn't fit (e.g. a pure puzzle case with no human cast).

- For each suspect that gets one, the assistant calls `add_document` with `doc_type: "suspect intake report"` and `design_instructions` describing the in-world police/agency form layout, then immediately calls `add_document_inline_images` for that doc with **one anchor slot** seeded from the suspect's existing portrait. Because we already have the locked-anchor logic, all suspect portraits across the case will look like they came from the same booking session (same camera, lighting, color palette).

- **New small flow**: when the assistant creates an intake doc and the suspect already has `thumbnail_url`, instead of generating a new image we set the inline image slot's `uploaded_url` = suspect.thumbnail_url and `active_version: "uploaded"` so the intake page reuses the existing portrait. If the suspect has no portrait yet, the slot is created empty (anchor) and the user (or assistant) generates it once — and that generated image is also pushed back to `suspects.thumbnail_url` so the intake doc and the Suspects panel stay in sync.

- **Realism baseline** is already enforced by the global `image_prompt_instructions` field; we'll update the assistant playbook to add a default "people must look like real photographs, never illustrations or 3D renders, unless the case style explicitly calls for stylized art" to that field whenever a project has suspects and no instruction is set.

- **Suspect UI sync (`SuspectsSection.tsx`)**: when the user updates a suspect's `thumbnail_url`, if an intake document for that suspect exists (linked by a new column `documents.linked_suspect_ids`, which already exists in the schema), the inline image slot's `uploaded_url` is updated automatically via a trigger or, simpler, on the client by writing both rows in the suspect-save mutation. We'll go with the client-side approach to avoid a new trigger.

---

## Technical summary

- **Migration** (one):
  - New table `bulk_generation_jobs` with realtime enabled, plus an `id, project_id, scope, mode, total, completed, failed, current_doc_id, status, started_at, finished_at, error` shape and the standard "auth all" RLS pattern used elsewhere in this app.

- **New edge function**: `supabase/functions/bulk-generate-documents/index.ts` — orchestrates per-doc calls into the existing `generate-document` function, writes job progress, handles concurrency + retries.

- **Edited edge function**: `supabase/functions/arrange-canvas/index.ts` — replaced layout core with a Sugiyama/Brandes-Köpf packer (Deno-native, no npm), removed naive overlap nudger, returns bounding box. Variants kept, `ai-refine` becomes group-hint mode.

- **Edited edge function**: `supabase/functions/assistant-chat/index.ts`:
  - Add tool `bulk_generate_documents`.
  - Extend system prompt with batch triggers ("continue / draft all / save as PDF") and the suspect-intake rule.

- **Edited edge function**: `supabase/functions/generate-document/index.ts` — add new mode `image_to_pdf` that wraps an existing image into a one-page PDF via the existing Claude skill pipeline (no new external API).

- **Edited UI**:
  - `src/features/project/CanvasSection.tsx` — call `fitView({ padding: 0.15 })` after arrange returns.
  - `src/features/project/DocumentsSection.tsx` — add Batch generate dropdown + sticky progress strip subscribed to the new table via realtime.
  - `src/features/project/SuspectsSection.tsx` — when saving thumbnail, also update the linked intake doc's anchor inline image slot if one exists.

Once you say it's good, I'll build it.
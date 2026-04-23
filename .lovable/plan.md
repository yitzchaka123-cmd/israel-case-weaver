

## Hints workflow + structural hint nodes on the Logic Flow

Three pieces, all centered on the existing `hints` table:

### 1. Wire hints into the Assistant + Canvas

Today the assistant only has `update_hint` — no way to **create** hints, no way to bulk-generate a stage, and no way to render them on the detective board. Fixes:

- **New tool `add_hint`** in `assistant-chat` — creates one row (`stage`, `level`, `text`).
- **New tool `generate_hint_stage`** — given a `stage` number + optional steering ("user is stuck on the alibi clue"), writes all 3 Hebrew hints for that stage in one call (vague → helpful → reveal), inserting all 3 rows.
- **Extend `add_canvas_node` enum** with `"hint"` so the assistant can place hint nodes on either board.
- **Playbook addition** to the system prompt (`renderHintsSystemBlock`): a new "HINT SYSTEM (Phase 5/6)" block explaining the 3-rung ladder, when to call `generate_hint_stage` vs `add_hint`, and that each stage should be tied to the clue/deduction it nudges toward.
- **New `hint` node type** added to `CanvasNodeType` + `NODE_META` in `CanvasNodeTypes.tsx` (icon: Lightbulb, accent amber `oklch(0.78 0.16 75)`).
- **Hints tab** gets a "Place on canvas" button per stage that creates a `hint` node on the **final** board pre-titled "Stage N hints".

### 2. Hint nodes on the auto-generated Logic Flow (NEW)

Extend `generate-logic-flow` so hint stages become **structural nodes** on the logic board, showing how each clue/deduction is supported by a hint ladder. Just the structure — text stays empty until the user (or assistant) writes it later.

- Add `"hint"` to the tool's `node.type` enum.
- Update the system prompt: after producing clues + deductions, instruct the model to emit **one `hint` node per clue/deduction that warrants a hint stage** (typically 3–5 hint nodes per case), titled `"Hint stage N — for: <clue/deduction title>"`, positioned in a vertical lane to the **left of clues** (x ≈ -200, y matching the clue it supports).
- Add **edges `hint_stage → clue/deduction`** with label `"hints toward"` so the board reads as: *hints → clue → deduction → solution*.
- Add `hint` to the `NODE_COLORS` map (amber) so the canvas renders them with the right tint.
- After insert, for each emitted hint node: create the matching empty 3-row scaffold in the `hints` table (`stage` = sequential, `level` 1/2/3, `text = ""`) so the Hints tab is pre-populated and the printed-card workflow has somewhere to go.

### 3. "Create hint sheet" image generator on each stage

Per stage, a new **"Create hint sheet"** button next to Remove. Clicking expands an inline `PromptPanel` block (the same component used for cover/suspect/media — gives the writer-model picker, "Generate prompt", editable Textarea, and "Generate image" with the image-model picker).

- "Generate prompt" passes `category: "hint-sheet"` to `suggest-image-prompt`, which we extend with hint-sheet guidance: *"Printable A6/A7 single-side hint card, large RTL Hebrew stage label, era-appropriate texture, room for 3 scratch-off panels, no spoilers visible."*
- "Generate image" posts to `generate-image` with `target: "hint-sheet"` and `targetId: <stage>`. The function persists URL + prompt + provenance onto the new `hint_sheets` row.
- Generated card appears inline above the 3 hint textareas, with the same hover **AiOriginBadge** + collapsible prompt history used elsewhere.

### 4. Schema + storage

**Migration:**
- New table `hint_sheets` (one row per stage):
  - `id`, `project_id`, `stage int`, `image_url text`, `prompt text`, `prompt_history jsonb default '[]'`
  - `effective_model text`, `fallback text`, `requested_model text`
  - Unique on (`project_id`, `stage`); RLS = same `Auth all` policies as `hints`.
- `canvas_nodes.node_type` is free text — only the UI/tool enum needs `"hint"` added.
- Storage: reuse `media` bucket under a `hint-sheets/` prefix.

### Behavior summary

| Surface | Before | After |
|---|---|---|
| Assistant tools | `update_hint` only | `add_hint`, `generate_hint_stage`, `hint` allowed in `add_canvas_node` |
| Assistant playbook | No hint guidance | New "HINT SYSTEM" block: when/how to write each rung, link to clue node |
| Logic Flow generator | clues / red_herrings / deductions / solution / envelopes | + `hint` nodes (structure only), edges `hint → clue/deduction`, auto-scaffolds matching `hints` rows |
| Canvas | No hint nodes | New `hint` node type (Lightbulb / amber) on both boards |
| Hints tab | 3 textareas per stage | Same + "Create hint sheet" image generator + "Place on canvas" button |
| `generate-image` | Targets media/suspect/cover/envelope | Adds `hint-sheet` target → persists to new `hint_sheets` row |
| `suggest-image-prompt` | 6 categories | Adds `hint-sheet` category with print-card guidance |

### Files touched

**Edge functions**
- `supabase/functions/assistant-chat/index.ts` — add `add_hint` and `generate_hint_stage` tools + executors; extend `add_canvas_node` and `update_canvas_node` enums with `"hint"`.
- `supabase/functions/_shared/assistant-playbook.ts` (and the `_shared` mirror) — add `renderHintsSystemBlock`.
- `supabase/functions/generate-logic-flow/index.ts` — add `"hint"` to tool enum + prompt + `NODE_COLORS`; post-insert, scaffold matching `hints` rows.
- `supabase/functions/generate-image/index.ts` — add `hint-sheet` target → persist to `hint_sheets`.
- `supabase/functions/suggest-image-prompt/index.ts` — add `hint-sheet` to `CATEGORY_GUIDANCE`.

**Frontend**
- `src/features/project/canvas/CanvasNodeTypes.tsx` — add `hint` (Lightbulb, amber) to `CanvasNodeType` and `NODE_META`.
- `src/features/project/HintsSection.tsx` — per-stage `HintSheetGenerator` (PromptPanel + AiOriginBadge + history); "Place on canvas" button.
- `src/components/PromptWriterModelPicker.tsx` and `src/components/ImageModelPicker.tsx` — extend surface union with `"hint"` so per-surface defaults are remembered separately.

**Migration** — create `hint_sheets` table with RLS matching `hints`.

### Out of scope

- Actual QR scratch-off PDF assembly — printer's job; we generate the source card image only.
- Two-way sync between a `hint` canvas node and the hint rows — "Place on canvas" is one-way.
- Diagnosing the earlier "21 nodes failed" assistant tool-call error — separate investigation, can do next.


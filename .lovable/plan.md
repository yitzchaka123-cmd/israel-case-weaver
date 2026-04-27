## Goal

Some documents are documents-with-pictures: a drone surveillance report needs 4 drone photos at the bottom; a forensic report needs 3 evidence photos; an interrogation file wants a mugshot. Today a document is **one image OR one file** — there is no concept of "document body + N inline images". This adds it, end to end:

- The **assistant decides** during planning whether a doc needs embedded images and how many.
- The **document editor UI** grows an "Inline images" panel with N slots — each with its own prompt, generate button, regenerate, history, and reorder.
- The **prompter is consistency-aware**: image #2/3/4 in a slot group automatically reference image #1 (or whichever is marked the "anchor") so all four drone photos look like the same drone, same camera, same lighting.
- The **PDF/DOCX renderer** embeds the images at the bottom of the document in the order shown.

## Data model — one new table + small additions

### New table: `document_inline_images`

```text
id                uuid pk
document_id       uuid → documents.id (cascade)
project_id        uuid → projects.id
position          int        -- 0-indexed display order
slot_label        text       -- e.g. "Drone shot 1", "Body — wide", filled by assistant
prompt            text       -- per-image prompt, editable
url               text|null  -- generated/uploaded image
uploaded_url      text|null  -- user upload override
active_version    text       -- 'generated' | 'uploaded'
prompt_history    jsonb      -- prior prompts (for revert)
url_history       jsonb      -- prior generated URLs
is_anchor         bool       -- true for the reference image of the group
anchor_image_id   uuid|null  -- if not anchor: which image to reference for consistency
group_key         text|null  -- 'drone-photos', 'evidence', etc. — multiple groups per doc allowed
provider, model, effective_model, fallback   -- origin badge data
status            text       -- 'pending' | 'generated' | 'failed'
error_message     text
created_at, updated_at
```

RLS: same "auth all" policies as `documents` (matches existing project tables).

### Tiny additions to `documents`

```text
inline_images_layout  text default 'bottom-grid-2col'  -- 'bottom-grid-2col' | 'bottom-grid-3col' | 'inline-after-text' | 'gallery'
inline_images_caption text                              -- optional shared caption
```

## Assistant-side: it decides + plans the slots

### New tool `add_document_inline_images`

```text
add_document_inline_images({
  document_id,
  layout,                  -- one of the layout enum values
  group_key,               -- optional grouping (consistency band)
  images: [
    { slot_label, prompt, is_anchor },
    { slot_label, prompt },
    ...
  ]
})
```

Inserts N rows into `document_inline_images`. Exactly one image per `group_key` MUST have `is_anchor=true`; the rest get `anchor_image_id` set to the anchor's id post-insert. Prompts are stored as drafted; nothing renders until the user (or `generate_document_assets`) hits Generate.

### Updates to existing tools

- `add_document` and `propose_document_set` get an optional `inline_images_plan` field on each entry: `{ count, group_key, layout, theme }`. When the assistant proposes the document set it can mark "Doc 14 — Drone surveillance log: needs 4 drone aerials, consistent look, group 'drone-feed'."
- `generate_document_assets` mode `"images"` (new) or `"both"` will also generate any pending inline images for that doc, in anchor-first order.

### Playbook rule (adds ~10 lines to the system prompt)

"When proposing a document, decide whether it visually requires embedded photos as part of the prop's realism (e.g. drone reports need aerial shots, autopsy reports need photo plates, evidence logs need item photos, dossiers need a mugshot). If yes, include `inline_images_plan` with the count, a `group_key` (so consistency can be enforced), a layout hint, and a one-sentence visual theme. Default `count` to the smallest believable number. NEVER inflate counts to pad the doc."

## Consistency-aware prompter

This is the smart bit. Lives in a new shared helper `_shared/inline-image-prompt.ts`:

```ts
buildInlineImagePrompt({
  doc,                  // doc context (title, doc_type, design_instructions)
  thisImage,            // current row (slot_label, prompt, position)
  anchor,               // null if this IS the anchor
  groupSiblings,        // already-generated sibling rows in same group
  projectImageStyle,    // project.image_prompt_instructions + user global notes
})
```

When `anchor` is set, the helper:

1. Fetches the anchor row from DB (its prompt + final URL).
2. Calls `suggest-image-prompt` (already exists) with a system message that injects the anchor's full prompt and a strict rule: *"Every output prompt MUST repeat these locked visual properties from the reference image: camera/sensor type, lens/focal length feel, lighting condition, time of day, weather, color palette, subject style, framing language. Vary ONLY the framing/subject of the new shot as described by the slot prompt."*
3. Returns the merged prompt and **also** passes the anchor's image URL to the image generator as a reference image input — Nano Banana / Gemini Image / GPT-Image all accept reference images, and the existing `generate-image` edge function already supports edit-mode (`url` input). We just route inline-image generation through that path when `anchor_image_id` is set.

So:

- **Image #1 (anchor)** = generated normally from `slot_label + prompt + project style`.
- **Images #2-N** = generated as **edits/variations of the anchor image** with a slot-specific prompt overlay. This guarantees "same drone, same lighting, same look" — far stronger consistency than text-only prompt sharing.

If the user manually uploads the anchor (drag-drop a real reference photo), the same logic kicks in — children will be generated as variations of the uploaded reference. This unlocks "I have one good drone shot, give me 3 more from different angles."

## UI — inside the document editor

In `DocumentsSection.tsx` editor, add a new section between "Final asset image" and "Final asset document":

```text
INLINE IMAGES                                    [+ Add image]   [Layout: ⬛⬛ 2-col ▾]

┌──────────────┐  ┌──────────────┐
│ [thumbnail]  │  │ [thumbnail]  │
│ "Drone 1"  ⭐│  │ "Drone 2"    │
│ Aerial view  │  │ Closer pass  │
│ over the…    │  │ on suspect…  │
│ [✨ Generate]│  │ [✨ Generate]│
│ [↻] [✎] [⋮]  │  │ [↻] [✎] [⋮]  │
└──────────────┘  └──────────────┘
┌──────────────┐  ┌──────────────┐
│ Drone 3      │  │ Drone 4      │
│ + Add prompt │  │ + Add prompt │
└──────────────┘  └──────────────┘

🔗 Group: drone-feed (4 images, anchor: Drone 1)   [Regenerate group from anchor]
```

Per slot:
- **Thumbnail** (or empty/dashed placeholder).
- **Slot label** — editable inline.
- **Prompt** — editable textarea, opens the existing `ImagePromptAssistant` popover for the AI-assisted writer.
- **⭐ Anchor toggle** — exactly one anchor per group; clicking another star moves the anchor.
- **Generate** — calls a new edge function `generate-document-inline-image` (mirrors `generate-image` but writes to `document_inline_images`).
- **Regenerate** — re-runs current prompt.
- **History** — small strip identical to the existing image history strip (`HistoryStrip`).
- **Drag handle** — reorders `position`.
- **Upload override** — drag-drop a file to fill the slot manually; sets `active_version='uploaded'`.

Group strip below shows: `[Regenerate group from anchor]` — wipes children, re-derives from current anchor. Useful when the user picks a new anchor.

Layout dropdown at the top is the `inline_images_layout` value: how the renderer arranges the photos (2-col grid, 3-col grid, single column inline after text, full-width gallery).

## Renderer — embedding in the final document

For Claude-Skills PDF/DOCX path (the existing direct file path):
- The existing `buildDocPrompt()` in `generate-document/index.ts` gets a new section listing inline images (`POSITION 1, label, signed URL, caption`) plus the chosen layout, and instructs the skill to embed them at the bottom in a grid matching the layout.
- We pass the actual public URLs (already in storage) to Claude as `image_url` content blocks alongside the text instruction so the skill can both reference and download them.

For ChatGPT image-only path (when the doc is *itself* a poster-style image): inline images are ignored — that flow generates one giant image. The UI hides the inline-images panel when the user picks `image` mode for `fileGeneration`.

## Files to create / change

**New**:
- migration: `document_inline_images` table + RLS + indexes; `documents.inline_images_layout`, `documents.inline_images_caption`.
- `supabase/functions/generate-document-inline-image/index.ts` — per-slot generation, anchor-aware (uses reference-image edit mode when child).
- `supabase/functions/_shared/inline-image-prompt.ts` — consistency-aware prompt builder.
- `src/features/project/documents/InlineImagesPanel.tsx` — the slot grid UI.
- `src/features/project/documents/InlineImageSlot.tsx` — single slot card.
- `src/features/project/documents/useInlineImages.ts` — query + mutations + Realtime sync.

**Edit**:
- `supabase/functions/assistant-chat/index.ts` — register `add_document_inline_images` tool, extend `add_document` and `propose_document_set` schemas with `inline_images_plan`, extend `generate_document_assets` to also generate pending inline images.
- `supabase/functions/generate-document/index.ts` — `buildDocPrompt` includes inline-image manifest; final doc payload to Claude attaches image URLs.
- `src/features/project/DocumentsSection.tsx` — render `<InlineImagesPanel />` between final-image and final-document sections; layout dropdown.
- `supabase/functions/suggest-image-prompt/index.ts` — accept `anchor_prompt` + `anchor_url` and prepend the consistency rule.

## Out of scope (future)

- Per-image **face/character** consistency across DIFFERENT documents (e.g. same suspect appearing in dossier + crime-scene photo). Doable later by adding a project-wide "character lock" that becomes the anchor for any matching slot. Not in v1.
- Video clips inline. Stays single hero video per doc for now.
- Image cropping / hotspot selection in the UI. Generated as-is, user re-prompts to reframe.

## Risk / trade-offs

- Reference-image variation is great for "same camera/look", weaker for "same person's face" — acceptable for drone shots, evidence photos, scenes; not perfect for repeated-character shots (covered by the future "character lock" item above).
- One row per inline image multiplies storage rows per project. With ~40 docs × avg 2 inline images = 80 extra rows per project. Negligible.
- Claude Skills must accept the image URLs at the size they're served; existing image storage is public, so signed-URL handling is not required.

---

Let me know what to revise. I'll iterate until you say it's perfect, then ship it.

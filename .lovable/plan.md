

## Approved + scope addition: prompts behind every assistant-shown image must land in the right UI field

Confirming and extending what we'll ship.

### What's already saved (no extra work needed)

`generate-image` and `generate-document` already write the prompt into the appropriate row column AND append to a prompt-history JSONB array, on every call:

| Asset shown in chat | Row field updated | History column |
|---|---|---|
| Document image | `documents.generated_asset_url`; prompt in `prompts` table (scope `document-image`) | — |
| Document Hebrew body | `documents.hebrew_content`; prompt in `prompts` table (scope `document`) | — |
| Suspect main thumbnail | `suspects.thumbnail_prompt` | `suspects.thumbnail_prompt_history` (last 20) |
| Suspect alt thumbnail | `suspects.alt_thumbnail_prompt` | `suspects.alt_thumbnail_prompt_history` |
| Envelope cover | `envelopes.cover_prompt` | `envelopes.cover_prompt_history` |
| Project cover | `projects.cover_prompt` | `projects.cover_prompt_history` |
| Hint sheet | `hint_sheets.prompt` | `hint_sheets.prompt_history` |

The Suspects, Envelopes, Cover, and Hints tabs already render those `*_prompt` fields in editable textareas with a history dropdown, so once the row is updated, the prompt shows up in the appropriate space automatically.

### What we'll add this turn (carries the user's approval forward)

**1. Fix the FK error so `add_document` / `add_suspect` / `add_canvas_node` / `add_envelope` succeed** — placeholder-insert the assistant `chat_messages` row up-front, then UPDATE it with the final body. Same in background (`processConversation`) and sync handlers. Skip rendering empty `in_progress` bubbles client-side (small "Working…" shimmer instead).

**2. Inline image receipts in chat** — three new mini-cards next to the existing `GeneratedDocReceipt`:
- `SuspectThumbnailReceipt` — appears whenever a tool call returns a new `thumbnail_url`.
- `EnvelopeCoverReceipt` — appears for envelope cover generation.
- `CanvasNodeImageReceipt` — for envelope-node art if/when generated.

Each card shows: thumbnail (click → fullscreen lightbox), the asset title, and a **"View prompt →"** link that jumps to the exact textarea in its tab (Suspects/Envelopes/Cover/Hints) where the saved prompt is editable. The link uses the same `mystudio:navigate` event pattern the origin badges already use.

**3. Bottom-of-message "Generated assets" strip** — `<GeneratedAssetsStrip>` aggregates every `image_url` from every tool in the turn into a single horizontal thumbnail row. Click → lightbox. Each thumb has a "Open in tab" affordance.

**4. New `AssetLightbox` component** (`src/features/project/assistant/AssetLightbox.tsx`) — shared fullscreen overlay with copy-prompt button (reads from the same row that owns the asset).

**5. Wire any NEW assistant-driven image generation through `generate-image`** — if/when we add an assistant tool that produces a suspect/envelope/cover image (currently only documents are auto-generated), it MUST route through the existing `generate-image` edge function so the prompt-persistence shown in the table above kicks in automatically. We do NOT introduce a new generation path that bypasses these columns.

### Files touched

- `supabase/functions/assistant-chat/index.ts` — placeholder-insert + final-update pattern; fixes the FK error; deploy.
- `src/features/project/AssistantSection.tsx` — three new receipt components, `GeneratedAssetsStrip`, in_progress bubble guard, "View prompt →" deep links.
- `src/features/project/assistant/AssetLightbox.tsx` — new shared lightbox.

### Out of scope

- Building a new "auto-generate suspect thumbnail" tool — separate request; today only documents auto-generate. When we add it, it must use `generate-image` (covered by point 5).
- A side-panel "Artifacts" view — inline receipts cover the user's stated need.
- Backfilling old prompt-less assets — every new generation from now on persists; older ones are unaffected.


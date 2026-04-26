## Goal

Replace the current single-prompt `PromptPanel` flow on **Documents** and **Envelopes** with a new **DocumentPromptAssistant** that thinks about one document/envelope at a time and outputs **two parts** in one structured response:

1. **Design Instructions** — extreme-detail graphic brief in **English** (paper, fonts, layout, look & feel, typography, margins, etc.)
2. **Content** — the exact final text that goes on the document, in the **project's chosen language** (Hebrew by default)

Both parts get saved into the existing columns:
- Documents → `design_instructions` + `hebrew_content`
- Envelopes → `design_instructions` + `label`/`task` (envelope's player-facing copy)

The image/PDF generator then uses **Design + Content** as its prompt. No templates, no fixed structure beyond the 2-part split — the assistant decides everything per-doc using project context + your typed instructions.

---

## UI: New `DocumentPromptAssistant` component

Lives at `src/components/DocumentPromptAssistant.tsx`, replaces `PromptPanel` only on Documents and Envelopes (other surfaces keep the existing `PromptPanel`).

**Layout** — collapsible panel above the document/envelope's generation buttons, with two tabs:

### Tab 1 — "Instructions" (your steering)
- Big textarea: free-text instructions like *"make it very detailed"*, *"add a coffee stain"*, *"keep it under 200 words"*, *"emphasize the timestamp"*.
- Empty is allowed. If you click **Generate prompt** with nothing typed, the assistant works from project context + the doc's title/type alone.
- Stored locally in component state (not persisted unless the user wants — out of scope for now; can add later).

### Tab 2 — "Final prompt" (the assembled output)
- Two read-write sections clearly labeled:
  - **🎨 Design Instructions (EN)** — large textarea, English design brief
  - **📝 Content (Hebrew)** — large textarea, exact final text in project language
- Editable so the user can tweak before generating.
- Empty until the user clicks **Generate prompt** at least once.

### Two action buttons in the panel header

| Button | Behavior |
|---|---|
| **Generate prompt** | Calls `suggest-image-prompt` with `mode: "structured-doc"`. The LLM returns `{ design_instructions, content }`. Fills Tab 2 and switches to it. **Does not generate the image/file yet** — user reviews. |
| **Generate automatically** | Skips Tab 2 entirely. Calls `suggest-image-prompt` (structured) → immediately calls `generate-document` with the result. One click, end-to-end, no review. |

Below the tabs, the existing buttons stay: **Generate Hebrew text**, **Generate image**, **Generate document file**. When the user clicks one of those, it now uses **whatever is in Tab 2** (Design + Content) instead of the old single prompt. If Tab 2 is empty, the buttons run with current `design_instructions` + `hebrew_content` already in the row (existing behavior preserved for backwards compatibility).

The `PromptWriterModelPicker` (per-surface writer-model dropdown) stays in the panel header, exactly like today.

---

## Edge function: extend `suggest-image-prompt`

Add a new mode the function recognizes via the `category` field:

- `category: "document-structured"` → returns `{ design_instructions: string, content: string }`
- `category: "envelope-structured"` → same shape, but content goes into envelope `label`/`task` split
- All existing categories (`cover`, `suspect`, `media`, `envelope`, `hint-sheet`, etc.) continue to return `{ prompt: string }` unchanged

### What changes inside the function

1. **New input fields** when structured mode is requested:
   - `documentId` or `envelopeId` (so the function can load the row's title, doc_type, print_size, envelope_number, linked_document_ids, etc.)
   - `userInstructions` (the Tab 1 free text)
   - `gameLanguage` (read from `projects.game_language`, default Hebrew)

2. **New system prompt** for structured mode (sketch):
   > You are a master prop designer and writer for boxed murder-mystery games. For ONE document at a time, you produce TWO things:
   >
   > **Part 1 — DESIGN_INSTRUCTIONS (English)**: an extremely detailed graphic-design brief covering document type, final print size (A4/A5/etc.), paper stock, look & feel (administrative / dramatic / aged / clean), typography (exact fonts, sizes, weights for title/headers/body), full layout, margins, RTL/LTR direction, color palette, stamps/handwriting/symbols ONLY if the document calls for them, footer, and any "do not include" rules. Think like a print designer.
   >
   > **Part 2 — CONTENT ({language})**: the exact final text that appears on the document, in {language}, ready to typeset. No meta-commentary, no English explanations, no placeholders.
   >
   > Return strict JSON: `{"design_instructions": "...", "content": "..."}`. No markdown, no preamble.

3. **Context fed to the model** (the assistant gets all of this so it can be coherent with the case):
   - Project: title, subtitle, genre, setting, year, mystery type, player role, case goal, image_prompt_instructions, **game_language**
   - This document/envelope: title, doc_type, doc_number, print_size, envelope_number
   - Suspects (top 8): name + role
   - **User instructions** from Tab 1 (highest priority)
   - Solution summary (so content can be plot-coherent without leaking spoilers — assistant is told to stay non-spoilery for non-final-reveal docs)
   - Project's `image_prompt_instructions` (global style guide)
   - Profile-level `image_prompt_assistant_instructions` (workspace style guide)

4. **JSON enforcement**: Use `response_format: { type: "json_object" }` for OpenAI; for Gemini/Claude, request JSON in the prompt and parse defensively (try/catch + fallback to splitting on labeled headers).

5. **Save behavior**: The edge function only **returns** the two parts — it does NOT write to the DB. The client decides whether to write (Generate prompt → fill Tab 2; user edits; user clicks generate → at that point client persists `design_instructions` + content field to the row, then triggers generation).

---

## Wiring into Documents and Envelopes

### `src/features/project/DocumentsSection.tsx` (the doc editor dialog)

- Replace the current prompt area (around line 308 `generate(...)` and the inline prompt UI nearby) with `<DocumentPromptAssistant documentId={doc.id} ... />`.
- When the assistant returns / user clicks generate:
  - Persist Tab 2 → `documents.design_instructions` + `documents.hebrew_content`
  - Then call existing `generate-document` with `mode: "image"` or `mode: "document"` — that function already reads `design_instructions` + `hebrew_content` from the row, so no change needed on the image/PDF side.
- "Generate Hebrew text" button becomes redundant for the new flow but kept as a fallback for legacy rows.

### `src/features/project/EnvelopesSection.tsx`

- Replace the current envelope-cover prompt UI with `<DocumentPromptAssistant envelopeId={env.id} ... />`.
- When persisting Tab 2:
  - `design_instructions` → `envelopes.design_instructions`
  - `content` → split into `label` (first line / heading) and `task` (rest), OR save the whole content into `task` and let user edit. **Recommendation: save full content into `task`, leave `label` editable manually**, since envelope `label` is usually 1–3 words and the assistant would over-fill it.
- Existing `generate-image` call for envelope cover continues to use `design_instructions` (already does).

### Other surfaces (Cover, Suspects, Media, Hints) — UNCHANGED

Per your answer "Documents + Envelopes only," these keep the existing `PromptPanel` exactly as it works today.

---

## File-by-file impact

| File | Change | Why |
|---|---|---|
| `src/components/DocumentPromptAssistant.tsx` | **NEW** — 2-tab assistant component | Replaces PromptPanel for docs/envelopes |
| `src/features/project/DocumentsSection.tsx` | Swap PromptPanel → DocumentPromptAssistant; persist 2 fields on generate | New flow |
| `src/features/project/EnvelopesSection.tsx` | Swap PromptPanel → DocumentPromptAssistant; persist design + task | New flow |
| `supabase/functions/suggest-image-prompt/index.ts` | Add structured mode (`document-structured` / `envelope-structured`) returning `{design_instructions, content}` | Backend support |
| `supabase/functions/generate-document/index.ts` | **No change** — already reads `design_instructions` + `hebrew_content` from the doc row | Already compatible |

No DB schema changes, no new columns. We're reusing `design_instructions` + `hebrew_content`/`task` which already exist.

---

## Edge cases & decisions baked in

- **Empty Tab 1** → "Generate prompt" still works; assistant uses project context only.
- **User edits Tab 2 then clicks Generate image** → edits are saved to the row first, then image is generated from the edited brief. WYSIWYG.
- **"Generate automatically" button** → runs structured assistant silently, persists both fields, then immediately runs the image/file generator. The output **is** the structured 2-part brief — same path as manual, just no review pause.
- **Language selection** → assistant reads `projects.game_language` (currently defaults to Hebrew). If you later change a project to English, the Content half automatically comes back in English on the next generation. No UI toggle needed.
- **Doc 0 (inventory)** still gets the special "plain white admin sheet" treatment we wired in last turn — the structured assistant will produce a clean design brief for it because the Tab 1 instructions (or the doc_type "Contents Checklist") will steer it that way. The previous Doc 0 hard-coded prompt path in `generate-document` stays as a safety net.
- **Backwards compat**: existing docs/envelopes with content already in `design_instructions`/`hebrew_content` show up pre-filled in Tab 2 the first time you open the assistant on them, so you can iterate instead of starting over.

---

## Out of scope (intentionally)

- Saving Tab 1 instructions per-doc to the DB (kept in component state for now — easy to add later if you want history).
- Applying this to Cover / Suspects / Media / Hints (you said docs+envelopes only).
- Migrating old `cover_prompt` / `prompt` columns or backfilling existing rows.
- Auto-rebuild of Tab 2 as you type in Tab 1 (you chose "on Generate prompt click").
- A "templates library" in the DB (you said "No templates!!! The assistant thinks one doc at a time").

---

## After approval, deployment order

1. Create `DocumentPromptAssistant.tsx`.
2. Extend `suggest-image-prompt/index.ts` with structured mode + redeploy.
3. Wire into `DocumentsSection.tsx`.
4. Wire into `EnvelopesSection.tsx`.
5. Smoke-test on the current project (Doc 0, a regular numbered doc, an envelope).
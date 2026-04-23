

## Extend `update_project` to cover every editable case-level field

### What's already working

`update_project` exists and the assistant is already trained to call it whenever you confirm a Case Identity / Case Brief field. Today it covers: **title, subtitle, phase, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count**. Receipts already render a structured "Mystery type · Year · …" diff and link back to the Overview tab. Because there's only one `projects` row per case, this tool can't create duplicates the way `add_suspect` could — it always patches the existing row.

So when you say *"change the title to 'The Beirut File'"* or *"set the genre to forensics"*, the model already calls `update_project` and the Overview panel updates immediately.

### What's missing (the gap this plan closes)

Several editable project columns have **no** chat-side update path today, so you have to leave the chat and edit them in the UI:

| Column | What it controls | Currently editable from chat? |
|---|---|---|
| `packaging_notes` | Phase 7 packaging brief | ❌ no |
| `image_prompt_instructions` | Per-project image-prompt style guide | ❌ no |
| `video_prompt_instructions` | Per-project video-prompt style guide | ❌ no |
| `hint_settings` (jsonb) | Stage/level hint config | ❌ no |
| `envelope_settings` (jsonb) | Envelope numbering & defaults | ❌ no |
| `cover_image_url` | Project cover image | ⚠ only via `generate_image` target=project-cover |

### What this change does

1. **Extend the `update_project` tool definition** to also accept `packaging_notes`, `image_prompt_instructions`, `video_prompt_instructions`, `hint_settings` (object), and `envelope_settings` (object). The executor already does a generic `.update(patch).eq("id", projectId)` — no executor changes needed beyond adding the keys to the JSON schema and to the merged-origins branch.
2. **Surface current values in CURRENT PROJECT STATE** for the new fields so the model can edit them intelligently instead of overwriting blindly. Long values are truncated to ~120 chars; jsonb settings are summarised as `(N keys)` with the keys listed.
3. **Tighten the prompt** with one extra triggers line: *"Whenever the user approves or revises packaging notes, image-prompt style, video-prompt style, hint settings, or envelope settings — call `update_project` with that field, same rules as for title/genre."*
4. **Extend the receipt renderer** in `AssistantSection.tsx` so the friendly-label map covers the new keys (`Packaging notes`, `Image prompt style`, `Video prompt style`, `Hint settings`, `Envelope settings`) and so jsonb values render as a compact `key: value, …` summary instead of raw JSON.
5. **Cover image stays on its dedicated path** — `generate_image` with `target=project-cover` already updates `projects.cover_image_url` and emits a media receipt. We won't duplicate that in `update_project`; the model will keep using the image tool for covers.

### Files touched

| File | Change |
|---|---|
| `supabase/functions/assistant-chat/index.ts` | (a) Add the 5 new optional properties to the `update_project` JSON schema (4 strings + 2 jsonb objects). (b) In `buildSystemPrompt` CURRENT PROJECT STATE, render `Packaging notes`, `Image prompt style`, `Video prompt style`, `Hint settings`, `Envelope settings` (truncated/summarised). (c) Add one bullet to TOOL USE listing the new triggers. (d) Add the new keys to the per-field origins-merge branch so each updated field's "jump to chat turn" pin still works. |
| `src/features/project/AssistantSection.tsx` | Extend `PROJECT_FIELD_LABELS` with 5 new entries. Update `formatFieldValue` to detect plain objects and render as `key: value, key2: value2` (capped to 80 chars) instead of raw JSON. |

### Technical notes

- `update_project` writes to a singleton row, so duplication is impossible by design — the EDIT-VS-CREATE rule that matters for child entities doesn't apply here, but the same UX guarantee holds: every confirmed field shows a clear "Updated: Title · Genre · Packaging notes" receipt.
- `hint_settings` and `envelope_settings` are jsonb. The tool will accept a full object and overwrite the column (it does NOT shallow-merge), matching how the rest of the app treats those columns. The system prompt will include the current keys so the model can echo them back when patching.
- Prompt-budget impact is small: the 5 new state lines are bounded (≤ ~600 chars total).
- No DB migration needed — every column already exists.

### What stays the same

- All existing `update_project` triggers (title, genre, year, etc.) keep working unchanged.
- `set_solution_summary`, `set_doc_generation_mode`, `generate_image` (cover), and the EDIT-VS-CREATE rule for child entities are untouched.
- Overview tab UI is unchanged — it already reads from the `projects` row, so new fields just start appearing once the assistant writes them.


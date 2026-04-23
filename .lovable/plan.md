

## "Generate idea" button + assistant awareness of user-entered fields

Two small but high-leverage additions to the Extra selling point flow.

### 1. "Generate idea" button on the Extra selling point

When the toggle is **on** (in `ProjectOverview.tsx`'s selling-point block), show a small **✨ Generate idea** button next to the textarea. Clicking it asks the assistant for a single, concrete selling-point idea tailored to the case (difficulty, mystery type, genre, year, setting, player role) and writes it straight into the field — so the user can either keep it, edit it, or click again for another shot.

**Where it lives**: Inside the `sellingOn && (...)` block in `src/features/project/ProjectOverview.tsx` (around line 354), above the existing Textarea. A small flex row with the button on the right.

**How it generates**: Reuses the existing `generate-marketing-copy` edge function with a new `field: "selling_point"` mode. The function already has access to project context — we just add a branch that returns a single 1–2 sentence punchy idea (e.g. *"A 1980s telex machine bundled in the box that decodes the final clue when the player feeds it the right paper tape."*).

- On click: spinner on the button, call the function, write result into `selling_point` via the existing `update({ selling_point })` (autosaves), and stamp `assistant_origins.selling_point = "manual-generate"` so the **by assistant** badge shows up.
- "Regenerate" label after first use, same button.
- No new tables, no new function — just a small extension of `generate-marketing-copy`.

### 2. Assistant awareness when the user pre-fills fields

Right now the assistant happily restates fields the user already typed (e.g. it'll "draft a subtitle" even though the user wrote one). Fix it by telling the model exactly which fields the **user** entered vs which it (the assistant) entered.

**How**: In `supabase/functions/assistant-chat/index.ts`, the system prompt already has a "CURRENT PROJECT STATE" block (lines 192–222). Add a derived `USER-EDITED FIELDS` line right after it:

```
USER-EDITED FIELDS (the user typed these themselves — do NOT propose to fill them; instead acknowledge in your next reply, e.g. "I see you already filled in <field> as '<value>' — want me to refine it or move on?"):
- subtitle: "<value>"
- setting: "<value>"
- selling_point: "<value>"
```

The list is built by walking every tracked field (`title`, `subtitle`, `mystery_type`, `genre`, `year`, `difficulty`, `player_role`, `case_goal`, `setting`, `selling_point`, `target_doc_count`) and including any field that has a non-empty value AND whose `assistant_origins[field]` is missing (= user-entered, not assistant-stamped).

A short, explicit rule paragraph is added to the playbook section near line 228:

> **USER-ENTERED FIELDS RULE**: For every field listed under USER-EDITED FIELDS, your first action is to acknowledge it out loud ("I see you already wrote the subtitle — keeping it.") and then either ask if the user wants you to refine it or skip past it. Do NOT silently overwrite it with `update_project`, and do NOT propose options for a field the user already filled.

This makes the assistant stop "stepping on" the user's input across the whole setup form, not just selling point.

### Files touched

| File | Change |
|---|---|
| `src/features/project/ProjectOverview.tsx` | Add **✨ Generate idea** button inside the sellingOn block; small handler that calls `generate-marketing-copy` with `field: "selling_point"` and writes the result via `update()`. |
| `supabase/functions/generate-marketing-copy/index.ts` | Add a `field === "selling_point"` branch that returns a single 1–2 sentence creative hook (uses existing project context + playbook). Returns `{ value: string }`. |
| `supabase/functions/assistant-chat/index.ts` | Append the derived `USER-EDITED FIELDS` block to the system prompt, plus the short USER-ENTERED FIELDS RULE paragraph in the reminder section. |

### Out of scope

- A separate "history of generated ideas" — each click just replaces the field; the user can copy/paste if they want to keep options.
- A full-blown "diff" between user text and assistant suggestion. The acknowledgement text in chat is enough.


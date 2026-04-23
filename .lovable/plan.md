

## Why fields look empty after the assistant "updates" them

The assistant **is** writing to the database — your second screenshot's tool receipt ("Case details updated · Genre: Police procedural / realistic · Mystery Type: Murder (רצח)") is real, and the Overview's origin badges (the small message-link icons next to each label) light up correctly because the row got patched.

But the dropdowns render blank. Why:

- `Mystery type`, `Genre`, and `Difficulty` are `<Select>` controls bound to **fixed option lists** in `ProjectOverview.tsx`:
  - `MYSTERY_TYPES` = Espionage / Political / Real Events / Terror / Cybercrime / Courtroom / Murder & Homicide
  - `GENRES` = Technological / Mathematical / Historical / Forensics / Psychological
  - `DIFFICULTIES` = Easy / Medium / Hard
- The assistant freely writes values **outside** those lists — "Police procedural / realistic", "Murder (רצח)", "בינוני", "Procedural". A `<Select>` whose `value` doesn't equal any `<SelectItem>` value renders the placeholder ("Choose…") — i.e. looks empty even though the row has data.
- `Title` (a free-text `<Input>`) does work — that's why "רחוב נווה צדק 12" *did* appear in the Title field on screenshot 1. So the bug is specifically the three constrained pickers + (separately) the case-brief fields the assistant didn't call `update_project` for.

The DB columns are plain `TEXT`, so nothing is rejected — the value is sitting in the row, just orphaned from any visible option.

### Fix — two parts

**1. Make the Overview pickers tolerant of any value the assistant writes** (`src/features/project/ProjectOverview.tsx`)

Convert the three `<Select>` controls (`mystery_type`, `genre`, `difficulty`) into a "combobox-lite" pattern: render the curated suggestions in the dropdown, but also:
- If the current `draft.<field>` value is non-empty AND not in the canonical list, prepend it as an extra `<SelectItem>` labeled `"<value>  · custom"` so the Select displays it correctly.
- Add a `Custom…` item at the bottom of each dropdown that swaps the control to a plain `<Input>` for that field (with a small "Back to presets" link) so users can also type freeform values.
- For `difficulty`, also normalize common assistant outputs at *render time* only: map `קל/בינוני/קשה` → `easy/medium/hard` (and `easy/medium/hard` case-insensitive) before comparing — so when the assistant writes Hebrew, the matching English option highlights.

Net effect: anything the assistant (or the user) writes is **always visible** in the Overview, and curated choices stay one click away.

**2. Tighten the assistant prompt so it stops drifting + always persists** (`supabase/functions/assistant-chat/index.ts`, system prompt only)

Add a short "CANONICAL FIELD VALUES" block to the system prompt:

```
When calling update_project, use these canonical values exactly:
- mystery_type ∈ {Espionage / Intelligence, Political Intrigue, Based on Real Events,
  Terror Plot, Cybercrime, Courtroom Drama, Murder & Homicide}
- genre ∈ {Technological, Mathematical, Historical, Forensics, Psychological}
- difficulty ∈ {easy, medium, hard}  (lowercase English; never Hebrew)

When the user replies in Hebrew or with a synonym, MAP it to the canonical
value before calling update_project. Examples:
  "רצח" / "Murder" / "Police procedural" → mystery_type: "Murder & Homicide"
  "בינוני" / "Medium" → difficulty: "medium"
  "פרוצדורלי" → genre: pick the closest of the 5 (usually "Forensics")
```

Also strengthen the existing rule so the assistant cannot skip persisting:
- After the user picks **mystery_type, genre, difficulty, or title**, the next assistant turn MUST start with an `update_project` tool call before any prose. If the model produces prose without the tool call, the prose is wrong.

(Schema enums for `update_project.difficulty` already constrain it to `easy/medium/hard` — the bug is just that the model is still answering with `בינוני`. The new prompt block fixes that.)

### Files touched

| File | Change |
|---|---|
| `src/features/project/ProjectOverview.tsx` | Combobox-lite for the 3 pickers + Hebrew↔English difficulty normalization. ~40 lines. |
| `supabase/functions/assistant-chat/index.ts` | Append canonical-values block + "tool-call-before-prose" rule to `buildSystemPrompt`. No tool/router/schema changes. |

### What this does NOT change

- Tool definitions, AI router, edge-function pipeline, message origins, the `assistant_origins` jump-to-message feature — all untouched.
- Existing rows already in the DB will display correctly the moment the picker change ships (no migration needed).
- The case-brief text fields (`player_role`, `case_goal`, `setting`, `selling_point`) are already plain inputs — they'll work as soon as the assistant actually calls `update_project` for them, which the strengthened prompt enforces.


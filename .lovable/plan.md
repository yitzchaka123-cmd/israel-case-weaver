# Planning Depth Modes for the Assistant

Add a per-project **Planning Depth** control with three modes that change how many questions the assistant asks before getting to the Logic Flow:

| Mode | Behavior |
|---|---|
| **⚡ Express** | Asks only for the case **title** (or auto-suggests one), confirms 1–2 absolute essentials (e.g. game language if not set), then auto-fills every other Phase 1 field with sensible defaults and jumps straight to generating the Logic Flow. No suspect interrogations, no per-clue questions. |
| **🎯 Guided** *(default)* | Asks the basics only — title, mystery type, genre, difficulty, year/setting. Skips deep-dive questions like player role nuances, motives per suspect, secrets, contradictions. Roughly the current flow but trimmed. |
| **🔬 Deep Dive** | Current "ask everything" experience PLUS deeper interrogation: walks the user through who did what, who stole what, every suspect's motive/secret/contradiction, red-herring rationale, clue-by-clue reasoning, and validates each beat before moving on. |

## 1. Database

Migration to add a column on `projects`:
- `planning_depth text not null default 'guided'` (allowed: `express`, `guided`, `deep`)

No backfill needed — existing rows get `'guided'` which matches today's behavior closely.

## 2. Shared playbook (`src/lib/assistant-playbook.ts` + `supabase/functions/_shared/assistant-playbook.ts`)

Add a new section to `Playbook`:
```ts
planning_depth: {
  default: "express" | "guided" | "deep";
  express: { skip_steps: string[]; auto_fill_defaults: Record<string,string>; jump_to: "logic_flow" };
  guided:  { ask_steps: string[] };  // subset of phase1_setup.order keys
  deep:    { extra_probes: string[] }; // e.g. ["per_suspect_motive","per_suspect_secret","per_clue_reasoning","red_herring_rationale"]
}
```

Defaults:
- `express.skip_steps`: everything except `language` (only if unset) and a single title pick
- `guided.ask_steps`: `["language","mystery_type","genre","titles","difficulty","year"]` (skip `role`, `goal`)
- `deep.extra_probes`: per-suspect motive, per-suspect secret, per-suspect contradiction, per-clue reasoning gate, red-herring justification

## 3. Assistant system prompt (`supabase/functions/assistant-chat/index.ts`)

In `buildSystemPrompt`, inject a new **PLANNING DEPTH** block based on `project.planning_depth`:

- **Express mode block:**
  > "User picked Express. Ask ONLY for the title (or propose 5 and let them pick). After title is locked, auto-fill missing identity fields with sensible defaults (mystery_type=Murder & Homicide, genre=Forensics, difficulty=medium, year=present day, game_language=Hebrew unless set), call `update_project` once with all of them, then immediately call `generate_logic_flow` and tell the user 'I'm jumping straight to the Logic Flow — review and approve it on the Canvas tab.' Do NOT ask about player role, case goal, setting, selling point, suspects' motives or secrets."

- **Guided mode block:**
  > "Ask only the basics: language (if unset), mystery_type, genre, title pick, difficulty, year. Skip player_role, case_goal, selling_point unless the user volunteers them. After year, propose Logic Flow generation."

- **Deep Dive mode block:**
  > "Use the full setup ladder, then probe deeply during Structure phase: for every suspect ask separately about motive, secret, contradiction, and how they relate to the victim; for every clue confirm what it proves and what red herring it counters; require the user to validate the deduction chain before generating documents."

The existing "one question per turn / propose_options" rules continue to apply in all three modes.

## 4. UI — model picker bar (`src/features/project/AssistantSection.tsx`)

Add a third compact `Select` next to **Chat** and **Images** in the model bar:

```
Depth: [⚡ Express ▾]  [🎯 Guided]  [🔬 Deep Dive]
```

- Reads/writes `projects.planning_depth` via the existing `setProjectAi` helper (extended to accept `planning_depth`).
- Tooltip on hover explains the three modes in one sentence each.
- The `useQuery` selecting project columns adds `planning_depth`.

## 5. New-project default

When a brand-new project is created with no chat history, the first assistant message includes a `propose_options` call with the three modes so the user picks depth up front before any other question. Implemented by adding a tiny pre-prompt in the system prompt: "If no chat_messages exist yet for this project AND planning_depth is still the default 'guided', your VERY FIRST message must offer the three depth options via propose_options before anything else."

## 6. Settings page (`src/features/settings/SettingsPage.tsx`)

In the existing **AI routing / defaults** section, add a "Default planning depth for new projects" select bound to a new `profiles.default_planning_depth` column (same enum). New projects copy this value when created. Migration adds the column with default `'guided'`.

## 7. Files touched

**Created**
- `supabase/migrations/<ts>_planning_depth.sql` — adds `projects.planning_depth` and `profiles.default_planning_depth`

**Edited**
- `src/lib/assistant-playbook.ts` — add `planning_depth` defaults + types + cleaner
- `supabase/functions/_shared/assistant-playbook.ts` — same (kept in sync)
- `supabase/functions/assistant-chat/index.ts` — read `project.planning_depth`, inject the matching depth block into the system prompt, ensure new-project depth picker fires first
- `src/features/project/AssistantSection.tsx` — depth select in the model bar, extend project query + `setProjectAi`
- `src/features/settings/SettingsPage.tsx` — default depth selector
- *(optional)* project create flow to seed `planning_depth` from `profiles.default_planning_depth`

**Deploy**
- `assistant-chat` edge function

## Open questions for you

1. Default for **existing** projects: leave at `guided` (matches today) — OK, or do you want me to flip them to `express`?
2. In **Express** mode, should I auto-pick a title too (so it's truly one click → Logic Flow), or always ask the user to pick from 5?

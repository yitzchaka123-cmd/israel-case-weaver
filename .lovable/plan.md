Plan: add per-case game language from setup through generation

1. Store the game language on each case
- Add a new `game_language` field to cases, defaulting existing/new cases to `Hebrew`.
- Keep it editable per case, separate from the global playbook so each game can have its own output language.

2. Add language options to the playbook
- Extend Assistant Playbook with a `languages` section containing selectable languages such as Hebrew, English, Arabic, Spanish, French, etc.
- Let you add/remove custom languages in Settings, so new languages can be introduced without code changes.
- Update the playbook preview text so the assistant sees the allowed language list.

3. Add language to case creation and the dashboard
- Add a language selector to the “New case” dialog.
- Show a language badge on every case card on the front dashboard.
- Add a dashboard language filter alongside difficulty, mystery type, genre, and phase.

4. Add language to the case Overview
- Add “Game language” under Case Identity.
- Autosave language changes the same way title, difficulty, genre, etc. already save.
- Show the assistant-origin badge if the assistant chose or changed the language.

5. Make language part of the assistant setup flow
- Add “Game language” as a Phase 1 setup step before title/content generation.
- Update assistant tool rules so when the user picks English/Hebrew/another language, it immediately calls `update_project` and saves `game_language`.
- Update the assistant system prompt so “final in-game content” means the case’s selected language, not always Hebrew.
- If the playbook has extra languages, the assistant will offer those as valid options.

6. Route all generated content through the selected language
- Update document generation so text output is in `project.game_language`, not hardcoded Hebrew.
- Update document image prompts so visible text rules reference the selected language and RTL/LTR guidance as appropriate.
- Update logic-flow generation so the solution summary follows the selected game language.
- Update related generation prompts where language is currently hardcoded or implied, especially envelopes, hints, marketing copy, and assistant-created document briefs.

7. Keep existing Hebrew games safe
- Existing cases will remain Hebrew by default.
- Existing playbook identity defaults remain compatible, but the per-case language overrides the final in-game language.

Technical details
- Database: schema migration adding `projects.game_language text not null default 'Hebrew'`.
- Frontend files likely touched: `Dashboard.tsx`, `ProjectOverview.tsx`, `AssistantSection.tsx`, `AssistantPlaybookPanel.tsx`, `src/lib/assistant-playbook.ts`.
- Backend functions likely touched: `assistant-chat`, `generate-document`, `generate-logic-flow`, and language-sensitive generation functions for hints/envelopes/marketing.
- Important: I will not manually edit generated backend type files; they update automatically.
Plan: tighten the Claude Skills implementation using the official Claude Code / Agent Skills docs

I’ll use the documentation you provided to correct the next implementation chunk. The important finding is that Claude Skills are filesystem-style `SKILL.md` packages with frontmatter and optional supporting files. The Agent SDK docs also say there is not a simple programmatic SDK registration API, so our app should treat uploaded skills as validated skill packages/receipts and only mark them truly usable when the Claude API path confirms support.

Progress:

- Done: SKILL.md/frontmatter validation, clearer install states, metadata display, chat/document runtime wiring, and playbook rules.
- Done in this chunk: archive manifest inspection for zip/tar uploads, package diagnostics in Settings, and skill-aware prompts for marketing, analysis, and media/storyboard surfaces.

Remaining follow-up:

1. Verify
- Run the app build after changes.
- If backend functions are edited, deploy the updated functions.
- Spot-check that Settings still loads Claude Skills, document generation only uses installed skills, and failed/needs-review uploads are visible with useful explanations.

2. Optional later polish
- Add a dedicated “Test skill” diagnostic action that calls a backend function with a harmless dry-run prompt.
- Add gzip decompression for `.tgz` if a Worker-compatible decompressor is needed; current validation can detect `SKILL.md` names but cannot extract compressed tar contents without remote/API confirmation.

Technical details
- Likely files to update:
  - `supabase/functions/install-claude-skill/index.ts`
  - `supabase/functions/_shared/claude-skills.ts`
  - `supabase/functions/assistant-chat/index.ts`
  - `supabase/functions/generate-document/index.ts`
  - `src/features/settings/ClaudeSkillsPanel.tsx`
  - `src/features/settings/AssistantPlaybookPanel.tsx`
  - `src/lib/assistant-playbook.ts`
  - `supabase/functions/_shared/assistant-playbook.ts`
- I do not expect schema changes unless the current `metadata`, `install_status`, `install_error`, `description`, and `notes` columns prove insufficient.
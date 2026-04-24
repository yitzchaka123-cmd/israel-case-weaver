Plan: tighten the Claude Skills implementation using the official Claude Code / Agent Skills docs

I’ll use the documentation you provided to correct the next implementation chunk. The important finding is that Claude Skills are filesystem-style `SKILL.md` packages with frontmatter and optional supporting files. The Agent SDK docs also say there is not a simple programmatic SDK registration API, so our app should treat uploaded skills as validated skill packages/receipts and only mark them truly usable when the Claude API path confirms support.

Next steps to build:

1. Validate uploaded skill packages more honestly
- Update the custom skill installer so it checks that uploads are real skill packages:
  - accept a `SKILL.md` upload directly, or a package/archive that clearly contains `SKILL.md`
  - validate/sanitize skill name rules: lowercase letters, numbers, hyphens, max 64 characters
  - extract or store frontmatter fields where possible: `name`, `description`, `when_to_use`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context`, `agent`, `paths`
- If the package cannot be verified as a Claude Skill, save it as `needs_review` with a clear message instead of pretending it is installed.

2. Improve install status and Settings UI
- Add clearer Settings labels for install states:
  - Installed and enabled
  - Saved, needs review
  - Invalid package
  - Remote registration/API limitation
- Show the parsed skill metadata in a friendly way before the raw JSON.
- Add helper text explaining that a Claude Skill is a `SKILL.md` package with optional supporting files, not just any file upload.

3. Improve runtime skill selection
- Extend the shared Claude Skills helper so skill availability uses both:
  - app surface scopes: chat, documents, marketing, analysis, media
  - skill metadata rules from the docs, especially `disable-model-invocation` / `user-invocable`
- Keep Claude document generation strict: only pass installed/enabled skills; failed or review-needed skills should not be passed into model calls.
- Add skill names/descriptions into assistant context so Claude knows what is installed and when it should use each skill.

4. Fix the custom skill install backend behavior
- Remove or downgrade any “remote install succeeded” assumption unless the remote API actually returns a valid skill/file registration response.
- Keep uploaded files saved, but distinguish:
  - local app catalog entry
  - validated Claude Skill package
  - actual remote/Claude-usable skill
- Save the full install receipt to `claude_skills.metadata` and show the failure reason in Settings.

5. Update playbook rules
- Add the practical Claude Skill rules from the docs:
  - skills are `SKILL.md`-based packages
  - descriptions decide when Claude should use them
  - supporting files should be referenced from `SKILL.md`
  - manual-only skills use `disable-model-invocation: true`
  - skills should be suggested when a repeatable playbook/checklist emerges
- Keep the existing direct-document rules: selected model gets first chance, no silent fallback, save prompts/receipts.

6. Verify
- Run the app build after changes.
- If backend functions are edited, deploy the updated functions.
- Spot-check that Settings still loads Claude Skills, document generation only uses installed skills, and failed/needs-review uploads are visible with useful explanations.

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
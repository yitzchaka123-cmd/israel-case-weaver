

## Make the assistant's playbook visible & editable from Settings

### The problem

Today the assistant's "house rules" live in three different places:

1. **Hardcoded prompt** in `assistant-chat/index.ts` — things like *"5 numbered Hebrew titles"*, *"3 hints per stage"*, *"Envelopes fixed at 5: Open First / 1 / 2 / 3 / 4"*, *"Phase 1 setup order: mystery_type → genre → titles → difficulty → role → goal → year"*, the canonical mystery-type / genre / difficulty lists, the design-instructions realism floor (20 details), etc. **Not editable from the UI.**
2. **Live project state** (suspects, documents, settings) — already editable inline.
3. **USER OVERRIDES / Assistant Tweaks** — already editable in Settings, but they're free-form *additions*, not a way to see and change the defaults.

So when you say *"easy games should have 7–8 suspects"*, there's nowhere in the UI to set that — your only option is to add a tweak rule, and you can't even see what the current default is.

### What we'll build

A new **"Assistant Playbook"** section in Settings (above Assistant Tweaks) that surfaces the previously-hardcoded knobs as plain editable fields. Tweaks stay as the free-form override channel. Live project data stays where it is.

The playbook is **per user, stored on `profiles`** (same pattern as `assistant_tweaks` and `image_prompt_assistant_instructions`). It's read once per chat turn by the edge function and merged into the system prompt — the wording around each value stays intact, only the value swaps in.

### The knobs we expose (v1, intentionally bounded)

Grouped into 5 collapsible cards, each card showing **Current default** vs **Your override** with a "Reset to default" link per field. Empty override = use default.

1. **Suspect counts by difficulty** — `easy: 5–6`, `medium: 6–7`, `hard: 8–10` (currently implicit). Editable as three integer ranges.
2. **Hints per stage** — number (default 3) and the vague→helpful→giveaway ladder labels.
3. **Envelopes** — count (default 5) and the fixed labels list (`Open First / 1 / 2 / 3 / 4`). Edit count and rename labels; if count changes, the labels list resizes.
4. **Phase 1 setup order** — the ordered list of fields the assistant collects in Phase 1 (currently `mystery_type → genre → titles → difficulty → role → goal → year`). Drag to reorder, toggle each on/off. Title-options count (default 5) is a separate number.
5. **Canonical vocab lists** — the three closed lists the model must map to: `mystery_type`, `genre`, `difficulty`. Add/remove/reorder values. Each value can carry Hebrew/English synonyms used by the mapping logic.
6. **Realism floor** — minimum realism details for real-world docs (default 20), minimum creative details for unusual props (default 8–15, two numbers).
7. **Document generation default mode** — `drafts | auto | ask` and whether to ask each new project. (Today the assistant always asks on first Phase 4 entry — this lets you skip.)

Each card has a small "?" tooltip explaining where in the assistant's behaviour the value shows up, plus a *"Show in prompt"* toggle that opens a side panel showing the exact prompt fragment that will be injected — so you can see the change before it ships.

### Files touched

| File | Change |
|---|---|
| `supabase/migrations/<new>` | Add one column on `profiles`: `assistant_playbook jsonb not null default '{}'::jsonb`. Single column keeps the schema small; the shape is enforced in TypeScript. |
| `src/features/settings/AssistantPlaybookPanel.tsx` *(new)* | Renders the 7 cards above. Reads from `profiles.assistant_playbook`, validates with a Zod schema, persists with the same upsert pattern `AssistantTweaksPanel` uses. Each field shows default vs override + reset link. Includes the *"Show in prompt"* preview drawer. |
| `src/features/settings/SettingsPage.tsx` | Insert the new `<AssistantPlaybookPanel />` in a new `Section` titled "Assistant playbook — defaults" placed directly above the existing "Assistant tweaks" section. Copy explains: *"These are the assistant's built-in defaults. Edit any value to change how it builds future cases — without losing the rest of the workflow."* |
| `src/lib/assistant-playbook.ts` *(new — shared)* | Exports `PLAYBOOK_DEFAULTS` (single source of truth for default values) and `resolvePlaybook(override)` which deep-merges override onto defaults. Used by both the Settings UI (to show defaults) AND the edge function (to compute the effective playbook). Also exports the Zod schema. |
| `supabase/functions/_shared/assistant-playbook.ts` *(new)* | Deno-compatible mirror of `PLAYBOOK_DEFAULTS` + `resolvePlaybook`. Kept as a separate file because Deno can't import from `src/`. Both files share the SAME literal defaults — a comment in each warns to keep them in sync, and we add a tiny unit-test-style script note in the PR. |
| `supabase/functions/assistant-chat/index.ts` | (a) Fetch `profiles.assistant_playbook` for the project owner alongside the existing tweaks fetch. (b) Pass `resolvePlaybook(playbook)` into `buildSystemPrompt`. (c) Replace the hardcoded magic numbers / lists in the prompt with template interpolations: suspect-count guidance line, hints-per-stage line, envelope count + labels in the Phase 4 paragraph, Phase 1 setup-order sentence, canonical field-value lists in the CANONICAL FIELD VALUES block, realism-floor numbers, doc-generation-mode default. Wording stays the same; only the values become dynamic. |

### Technical notes

- **No breaking change for existing projects.** If `assistant_playbook` is `{}`, every value falls back to the current hardcoded default — the prompt comes out byte-identical to today.
- **Playbook is per-user, not per-project**, matching how Tweaks and Image-prompt-assistant-instructions already work. If we later want per-project overrides, we add a second `projects.assistant_playbook` jsonb and merge user → project → defaults; the resolver already supports a chain.
- **Source-of-truth duplication risk** between `src/lib/assistant-playbook.ts` and `supabase/functions/_shared/assistant-playbook.ts` is real but small (≈80 lines of constants). We mitigate with a header comment in both files: *"If you change defaults here, change the other file too."* Long-term we can codegen one from the other; not worth it for v1.
- **Validation:** the edge function calls `resolvePlaybook` which silently drops unknown keys and clamps numbers to safe ranges (e.g. suspect-count min 1, max 30). A malformed playbook never breaks the chat — worst case it falls back to defaults.
- **Prompt budget:** the canonical-vocab / phase-order / counts substitutions don't add net characters vs today; the playbook injection is bounded.

### What stays the same

- Assistant Tweaks (free-form rules), Image-prompt assistant instructions, all per-project overview fields, all `update_*` tools, the EDIT-VS-CREATE rule, the `update_project` extensions we just shipped, the doc-generation-mode flow, the canvas/logic-flow gate.
- The chat experience is unchanged unless you actually edit a playbook value.

### Out of scope for v1 (good follow-ups)

- A free-form **"View full system prompt"** debug panel that renders the entire resolved prompt (defaults + playbook + tweaks + project state) — useful but heavier; can land later as a read-only modal.
- Per-project playbook overrides.
- Localising playbook copy into Hebrew.


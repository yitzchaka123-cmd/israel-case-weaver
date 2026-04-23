

## Add 6 more cards to the Assistant Playbook

The v1 playbook surfaced the *numbers and lists*. The remaining hardcoded behavior in `assistant-chat` is mostly **wording, rules, and catalogs** that you might want to retune without me re-touching the prompt. This adds 6 new cards under the existing playbook, using the same "default vs override + reset" pattern, the same `profiles.assistant_playbook` JSONB column (no migration needed), and the same `resolvePlaybook` resolver.

### The 6 new cards

1. **Identity & voice** — three short text fields:
   - Planning language (default: *"English"*)
   - Final in-game content language (default: *"Hebrew, grammatical, RTL-ready, immersive"*)
   - Brand voice line (default: *"Premium realism, intelligence-style deduction, layered non-linear solvability. No fantasy. No external knowledge required."*)
   - Setting flavor (default: *"Always set stories in Israeli environments with Israeli flavor."*)

2. **Content rules** — editable bullet list (default 3 items: no sexual content, no real politicians/army figures by name, no single document spoils the solution). You can add, remove or reword each rule. They render verbatim under the existing CONTENT RULES heading.

3. **Document design-instructions skeleton** — the 10 ordered sections every `add_document` call must produce (GOAL → CRITICAL TEXT QUALITY → OUTPUT FORMAT → VISUAL STYLE → LAYOUT → TYPOGRAPHY → AUTHENTICITY RULES → EXACT HEBREW TEXT → ADDITIONAL REALISM DETAILS → FINAL INSTRUCTION). Each section is a row with a name and an optional one-line guidance note. Reorder, rename, toggle off, or add new sections — the prompt regenerates the "Format it with these sections, in this order:" line dynamically.

4. **Doc-generation mode labels & gate copy** — the three button labels the assistant offers on first Phase 4 entry (defaults: *"Drafts only — I'll generate myself"* / *"Full auto — generate text + image now"* / *"Ask me each time"*) and the Logic-Flow refusal message (the 2–3 sentence "jump to Canvas → Logic Flow…" copy). Both render verbatim into the prompt.

5. **Document catalogs** — two editable lists used as soft hints to the model:
   - **Print sizes** (default: A4, A5, Letter, Half-letter, Square 15×15, Index card 4×6, Photo 10×15). Free add/remove.
   - **Document types** (default: memo, letter, report, transcript, newspaper, photo, ID card, receipt, telegram, police form, bank statement, medical record, ticket stub, business card, map, diagram, cipher, blueprint, ransom note). Free add/remove.
   These get injected as `Available print sizes: …` and `Common document types: …` reference lines so the model picks from your catalog instead of inventing values.

6. **Phase definitions** — the ordered list of phases with their `key` (matches the `phase` enum), display label, and one-line description (defaults match today: setup / summary / structure / documents / envelopes / hints / packaging / done). You can rename labels, edit descriptions, reorder, or add a new phase row. The `phase` enum on `update_project` is regenerated from this list (so adding "playtest" makes it a valid phase value automatically). The Phase 3.5 Logic Flow gate stays as a separate switch — it's structural, not a phase.

Each card keeps the same UX as v1: collapsible header, **Current default** column vs **Your override** column, per-row "Reset to default" link, "?" tooltip explaining where the value shows up in the assistant's behavior, and a "Show in prompt" preview toggle.

### Files touched

| File | Change |
|---|---|
| `src/lib/assistant-playbook.ts` | Extend the `Playbook` type with 6 new top-level keys: `identity`, `content_rules`, `design_skeleton`, `doc_mode_copy`, `catalogs`, `phases`. Add their literal defaults to `PLAYBOOK_DEFAULTS`. Extend `resolvePlaybook` with cleaners for each (`cleanStringArray` reused; new `cleanRuleList`, `cleanSectionList`, `cleanPhaseList` mirror the existing `cleanVocab` shape — drop unknown keys, trim strings, fall back to default if empty). Add 5 new `render*` functions (`renderIdentityBlock`, `renderContentRulesBlock`, `renderDesignSkeletonLine`, `renderDocModeButtonsBlock`, `renderCatalogsBlock`, `renderPhaseEnumComment`). |
| `supabase/functions/_shared/assistant-playbook.ts` | Mirror the same changes line-for-line (kept in sync per the existing header comment). |
| `supabase/functions/assistant-chat/index.ts` | (a) Replace the hardcoded IDENTITY & STYLE / CONTENT RULES / design-instructions skeleton / doc-mode button labels / Logic-Flow refusal copy / phase enum comment with calls to the new renderers. (b) Inject `Available print sizes` and `Common document types` reference lines into the design-instructions guidance block. (c) Regenerate the `phase` enum on `update_project`'s JSON schema from `playbook.phases.map(p => p.key)` so renaming/adding phases in Settings makes them valid tool arguments. (d) No new prompt sections — every renderer slots into a place the prompt already had. |
| `src/features/settings/AssistantPlaybookPanel.tsx` | Add 6 new collapsible cards below the existing 7. Each follows the existing pattern: read field from `assistant_playbook`, show default vs override, list editor with add/remove/reorder for the lists, reset link per row, "Show in prompt" preview that calls the matching renderer. No new dependencies — keep the same drag-handle/list primitives already used by the Phase 1 setup-order card. |

### Technical notes

- **No DB migration.** Everything fits in the existing `assistant_playbook` JSONB column. Old rows whose JSON doesn't contain the new keys get the literal defaults via `resolvePlaybook` — chat output stays byte-identical until you actually edit something.
- **Phase enum safety.** `update_project`'s `phase` enum becomes dynamic. The resolver clamps the list to a max of 16 phases and forces `key` to a `[a-z_]{1,32}` slug so the enum never accepts garbage. Existing `phase` values not in the user's list are still preserved on the row (the enum only restricts *new writes*); a tiny note in the card warns: *"Renaming a phase key won't migrate existing projects — they keep their old phase string until you edit them."*
- **Prompt budget.** Net additions are bounded: the new render blocks replace existing literal text 1:1 except for the catalog reference lines (~150 chars total) and the design-skeleton list which can grow if you add sections. Worst case adds ≤ 1 KB of prompt.
- **Validation.** Same defensive style as v1: malformed override silently falls back per-key. Empty list → use default list. Empty string → use default string. Reordering preserves your existing entries by `key` match (for sections / phases) so renames don't double-up.
- **No new tools, no new edge functions, no UI changes outside `AssistantPlaybookPanel`.** The chat experience is unchanged unless you touch a value.

### What stays out of scope (still good follow-ups)

- A read-only **"View full resolved system prompt"** debug modal (v1 already mentioned this; still a good next step now that more of the prompt is data-driven).
- Per-project playbook overrides (resolver already supports a chain).
- A real schema-driven editor for the design-skeleton sections' inner format (today the user just edits the section name + one-line note; the actual subsection rules stay implicit).


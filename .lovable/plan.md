

## Assistant tweaks — teach the assistant your house rules

### What this gives you

A new **Assistant tweaks** panel in Settings where you talk to a small AI in plain English and it converts what you say into short, persistent rules that get injected into the main Assistant's system prompt on every project, every turn.

Examples you could say:
- *"Add way more design instructions when generating documents."*
- *"Stop suggesting noir genres, I'm tired of them."*
- *"Always propose at least 6 suspects, not 4."*
- *"Forget the rule about red herrings being a minimum of 2."*

The mini-AI parses each request, decides whether it's an **add**, **edit**, or **remove**, and updates a clean numbered list of rules you can see and hand-edit at any time.

### How it works

```text
Settings → Assistant tweaks
┌──────────────────────────────────────────────────────────┐
│  Active rules (5)                                        │
│  1. Documents must include at least 25 realism details   │
│  2. Always offer 6+ suspects, not 4                      │
│  3. Avoid noir genre suggestions          [edit] [×]     │
│  ...                                                     │
├──────────────────────────────────────────────────────────┤
│  💬 Talk to the tweaks assistant                         │
│  [ "Add more design instructions to docs"      ] [Send]  │
│  → Added rule: "Expand design_instructions to..."        │
└──────────────────────────────────────────────────────────┘
```

The rules live on your **profile** (one global list across all projects). When the main Assistant runs, it pulls your rules and appends them to its system prompt under a clearly-labeled **USER OVERRIDES** section that takes precedence over the defaults.

### The plan

**1. Database** — add one column to `profiles`:
- `assistant_tweaks jsonb default '[]'::jsonb` — array of `{ id, text, created_at }` objects.

**2. Settings UI** — new `AssistantTweaksPanel` component placed in `SettingsPage.tsx` between *Image-prompt assistant* and *AI provider routing*:
- **Active rules list** — numbered rules with inline edit + delete buttons. Clean card per rule.
- **Mini chat composer** — single textarea + Send button (and a mic button reusing your `useVoiceInput` hook for parity with the main Assistant). Below it: a tiny transcript of the last 3 turns showing what the mini-AI did ("Added rule #6", "Removed rule #2", "Edited rule #4").
- **Manual edit fallback** — each rule row also lets you click the text to edit directly without going through the chat.

**3. New edge function** `assistant-tweaks-edit`:
- Input: `{ currentRules: Rule[], userMessage: string }`.
- Calls Lovable AI Gateway (Gemini 2.5 Flash — cheap, fast, JSON-mode) with a system prompt: *"You convert a user request into one or more atomic edits to a list of rules. Output JSON: { actions: [{ op: 'add'|'edit'|'remove', id?, text? }], reply: string }."*
- The function applies the actions to `profiles.assistant_tweaks` server-side (so the model can't write garbage shapes), returns the updated list + a short conversational reply ("Added that. Anything else?").

**4. Wire tweaks into the main Assistant** — in `supabase/functions/assistant-chat/index.ts`:
- Load `profile.assistant_tweaks` alongside the project (one extra query).
- In `buildSystemPrompt`, append a new final section **after** the existing rules:
  ```
  USER OVERRIDES (highest priority — follow these even if they
  conflict with earlier instructions, unless they violate
  CONTENT RULES):
  1. <rule text>
  2. <rule text>
  ...
  ```
- Content-rule violations (no sex, no real politicians, etc.) still win — those stay above user overrides.

**5. Visibility hooks** — small badge on the main Assistant header showing **"N tweaks active"**, clicking it opens Settings → Assistant tweaks. So when the assistant behaves unexpectedly you immediately know your overrides are in play.

### Files to change

- `supabase/migrations/<new>.sql` — add `assistant_tweaks` column.
- `supabase/functions/assistant-tweaks-edit/index.ts` — new function (Gemini Flash, JSON mode, server-side apply).
- `supabase/functions/assistant-chat/index.ts` — load profile tweaks, append USER OVERRIDES block.
- `src/features/settings/AssistantTweaksPanel.tsx` — new component (rules list + mini chat + manual edit).
- `src/features/settings/SettingsPage.tsx` — mount the new panel.
- `src/features/project/AssistantSection.tsx` — small "N tweaks active" chip linking to Settings.

### Acceptance check

1. Open Settings → Assistant tweaks → say *"Add more design instructions when generating documents."* → a new rule appears in the list and a confirmation appears.
2. Open any project → Assistant header shows *"1 tweak active"*.
3. Ask the assistant to draft a document → the `design_instructions` it produces is visibly longer / more structured than before.
4. Go back to Settings → click the × on the rule → ask for another doc → the override is gone.
5. Type *"actually remove the rule about design instructions"* in the mini chat → rule is removed without manual clicking.


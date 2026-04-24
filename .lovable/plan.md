Here’s how I’d make the assistant help with settings, while keeping the Settings screen clean.

## Direct answers to your examples

### 1. “I don’t like the way this document was generated. Remember this going forward.”
Yes — the assistant should be able to turn that into a saved rule automatically.

Example:
- You: “This document is too thin. Going forward, legal documents need more body text, more realistic stamps, and less generic wording.”
- Assistant should:
  1. Understand this is not just a one-time edit.
  2. Ask a short confirmation if it’s broad: “Should I save that as a future document rule?”
  3. Save it into Assistant rules/settings if you say yes.
  4. Use it in future document writing and generation prompts.

If the user says something explicit like “remember this”, “always”, “going forward”, “don’t do this again”, it can save the rule immediately and tell you what it saved.

### 2. “Change the theme of the app to dark.”
Yes — the assistant should be able to change simple personal settings from chat.

Example:
- You: “Change the theme to dark.”
- Assistant should call a settings tool, persist the theme to your profile, and the UI should switch to dark without you going into Settings.

### 3. “I don’t want to add anything to settings like crazy.”
Agreed. I would not add lots of new settings pages or forms. The main change should be that the assistant gets a few safe settings tools, and the existing Assistant rules area becomes the place where saved preferences are visible/editable.

## What I’d build

### A. Give the project assistant a “settings brain”
Right now the main assistant can update case/project data, create documents, create canvas nodes, etc. It already reads `assistant_tweaks`, but it cannot write those rules from the main chat.

I’d add assistant tools for:

1. `save_assistant_rule`
   - Saves a future behavior rule, like:
     - “Generated documents must include more body text and fewer generic labels.”
     - “Interrogations should include longer realistic dialogue and pauses.”
     - “Avoid overly clean graphic design unless the document is official.”

2. `remove_assistant_rule` / `update_assistant_rule`
   - Lets you say:
     - “Forget the rule about short documents.”
     - “Change that rule to only apply to police reports.”

3. `update_user_settings`
   - Handles safe user-level settings:
     - theme: light/dark
     - display background
     - default planning/document/image/prompt-writer model preferences
     - image prompt assistant instructions

4. Possibly `update_project_settings`
   - For current-case settings already stored on the project:
     - image style instructions
     - video prompt instructions
     - document generation mode
     - envelope/hint settings

### B. Make the assistant recognize “feedback that should become memory”
I’d update the assistant instructions so it classifies feedback like this:

```text
User says: “Make this one document longer.”
→ One-time edit: update the current document only.

User says: “Documents like this need to be longer.”
→ Ask whether to save as a rule.

User says: “Going forward, all documents need more content.”
→ Save as an assistant rule immediately, then confirm.
```

This matters because not every complaint should become a permanent setting. If you hate one specific result, the assistant should fix that result. If you say “always / going forward / remember”, it should store the preference.

### C. Show saved rule receipts in chat
When the assistant saves something, it should not silently change settings. It should say something like:

```text
Saved as a future assistant rule:
“Documents must include fuller body text, specific case details, and realistic formatting notes before generation.”

I’ll apply this to future documents.
```

That makes the assistant feel smarter without hiding state from you.

### D. Keep Settings simple
I would not create a new giant “Assistant controls everything” settings page.

I’d reuse the existing Settings → Assistant rules panel, but improve it slightly:
- Show rules saved from chat.
- Label them as “Saved from assistant chat” when relevant.
- Keep edit/delete controls.
- Maybe add small examples like:
  - “Always make police reports longer and more procedural.”
  - “Avoid generic evidence documents.”
  - “Use darker, more worn visual design for printed props.”

### E. Make app theme changes actually sync
The current theme system uses local storage and the Settings page also saves `theme` to the profile. I’d tighten that up so when the assistant changes theme:
- it updates the profile,
- the current browser applies the theme immediately,
- Settings reflects the new value.

For chat-triggered updates, I’d add a lightweight app event/query invalidation so the UI changes right away after the assistant tool succeeds.

## Important behavior rules

The assistant should be allowed to change settings, but with guardrails:

1. Safe direct changes can happen immediately:
   - “Set dark mode.”
   - “Use ChatGPT Image 2 for images.”
   - “Set document mode to drafts only.”

2. Broad creative rules should be saved when explicit:
   - “Always make documents longer.”
   - “Going forward, avoid generic content.”
   - “Remember that I prefer realistic messy paperwork.”

3. Ambiguous feedback should ask once:
   - “This document is bad” should trigger:
     - “Do you want me to revise only this document, or save a future rule too?”

4. The assistant should never silently change sensitive/admin settings.
   - API keys, team access, invite codes, and permissions should stay manual/admin-only.

## Technical implementation plan

### 1. Extend `assistant-chat` tools
Edit `supabase/functions/assistant-chat/index.ts`:
- Add tool definitions:
  - `save_assistant_rule`
  - `update_assistant_rule`
  - `remove_assistant_rule`
  - `update_user_settings`
- Add execution handlers that update the owner profile safely.
- Add prompt instructions that teach the assistant when to save a rule vs when to ask first.

### 2. Reuse the existing assistant rules storage
Use the existing `profiles.assistant_tweaks` JSON list for saved assistant behavior rules.
No new table is required unless we want richer audit history later.

I would store rules in the same shape as the existing tweaks panel already expects:

```ts
{ id, text, created_at }
```

Optionally add metadata later, but avoid breaking the existing UI.

### 3. Add user settings updates
For `update_user_settings`, update safe fields on `profiles`:
- `theme`
- `ui_background`
- `ai_provider_planning`
- `ai_provider_documents`
- `ai_provider_images`
- `ai_provider_prompt_writer`
- `image_prompt_assistant_instructions`

Do not allow this tool to touch admin/team/API-key settings.

### 4. Make theme/profile sync better
Update `src/lib/theme.tsx` and/or shell/profile query behavior so profile theme changes can be applied immediately after the assistant updates them.

Likely approach:
- keep local storage for fast startup,
- also listen for a browser event like `mystudio:settings-updated`,
- refetch profile settings after assistant tool receipts,
- apply theme when profile theme changes.

### 5. Surface setting changes in chat UI
Update `src/features/project/AssistantSection.tsx` so tool receipts for saved rules/settings look clear and useful.

Examples:
- “Rule saved”
- “Theme changed to dark”
- “Image model preference updated”

Also invalidate relevant queries after assistant runs so Settings/AppShell refresh.

### 6. Improve Settings → Assistant rules lightly
Update `AssistantTweaksPanel` only if needed:
- make the empty state explain that rules can now be saved from normal assistant chat,
- maybe show examples,
- keep the UI simple.

## Resulting experience

You’d be able to stay in the assistant and say things like:

```text
This invoice document is too short and generic. Going forward, every official document needs at least 2x more body text, realistic bureaucratic details, and clearer case-specific clues.
```

The assistant would save that as a future rule and apply it next time.

Or:

```text
Change the app to dark mode.
```

The assistant would switch the app theme and confirm.

Or:

```text
Don’t remember this forever, just rewrite this document with more content.
```

The assistant would only update that document, without saving a global rule.
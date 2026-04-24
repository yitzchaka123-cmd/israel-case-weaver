
## Redesign the Storyboard Studio so it is understandable and usable

### Goal

Replace the current cramped three-column storyboard UI with a clearer production workflow that answers, at a glance:

```text
Where am I?
What do I do next?
Which shots are drafted?
Which prompts are ready?
Which keyframes are generated?
```

The current layout technically works, but it hides the process inside three dense columns. On smaller screens it becomes especially hard to understand.

---

## New storyboard structure

### 1. Add a clear header and progress summary

At the top of `StoryboardStudio`, add a production-style header:

```text
Storyboard Studio

Build a trailer-style sequence in 3 steps:
1. Draft shots
2. Write video prompts
3. Generate keyframes

[Length] [Save] [New version]
```

Below that, add compact progress cards:

```text
Shots drafted        8
Prompts ready        5 / 8
On storyboard        4 / 8
Keyframes generated  3 / 4
```

This makes the state of the storyboard visible immediately.

---

## 2. Replace the confusing 3-column wall with guided workflow tabs

Instead of showing all three dense columns at once, convert the studio into three large workflow tabs:

```text
[1 Script] [2 Prompts] [3 Storyboard]
```

Each tab focuses on one task.

### Script tab

Purpose: create and edit the shot list.

Layout:

```text
Script setup
[Length picker]
[Script instructions textarea]
[Generate / regenerate script]

Shot list
Shot 1
- Action
- Voiceover
- On-screen text
- Send to prompts

Shot 2
...
```

Improvements:
- Larger shot cards.
- Clear labels instead of tiny dense controls.
- “Send to prompts” becomes a full readable button.
- Add a “Send all to prompts” action near the shot list.

---

### Prompts tab

Purpose: turn approved shots into Sora/Kling prompts.

Layout:

```text
Prompt settings
[Sora instructions]
[Kling instructions]

Prompt queue
Shot 1
- Source action preview
- Engine selector
- Prompt textarea
- Generate prompt
- Send to storyboard
```

Improvements:
- The original shot action is shown clearly above the prompt.
- Engine selection is readable.
- Prompt textarea has more space.
- “Generate prompt” and “Send to storyboard” are visually separated so it is obvious what each does.

---

### Storyboard tab

Purpose: see the actual visual board and generate keyframes.

Layout:

```text
Storyboard board
[Image model selector]
[Generate missing keyframes] [Copy all prompts]

Shot 1 card
[16:9 image/keyframe]
Action summary
Prompt preview
Generate / regenerate keyframe
```

Improvements:
- Use a responsive grid for storyboard cards:
  - mobile: 1 column
  - tablet: 2 columns
  - desktop: 2–3 columns depending on available width
- Make generated images the visual focus.
- Keep model/provenance badge on generated images.
- Make missing images obvious with a clean placeholder.

---

## 3. Add a sticky “Next step” guide

Add a small contextual guide near the top of the studio:

Examples:

```text
Next step: Generate a script to create your shot list.
```

```text
Next step: Review the shots, then send them to Prompts.
```

```text
Next step: Generate prompts for 3 remaining shots.
```

```text
Next step: Generate keyframes for the storyboard.
```

This removes the guessing about what to do next.

---

## 4. Improve mobile and touch layout

The storyboard is currently too dense for the user’s current preview size.

Changes:
- Remove the mandatory `lg:grid-cols-3` workflow wall.
- Use full-width stacked sections on mobile.
- Make the workflow tabs horizontally comfortable and touch-friendly.
- Increase button hit areas.
- Avoid tiny icon-only actions where the meaning is unclear.
- Keep destructive actions like delete visible but not dominant.

---

## 5. Keep all existing functionality

This is a UI/UX redesign only. Existing data and generation flows stay intact:

- `project_storyboards` remains the saved source of truth.
- Script generation still uses `generate-storyboard` with `mode: "script"`.
- Prompt generation still uses `generate-storyboard` with `mode: "prompt"`.
- Keyframes still use `generate-image` with category `marketing-storyboard`.
- Save / New version behavior remains.
- Existing storyboards already in the database continue to load.

No database migration is required.

---

## 6. File to edit

### `src/features/project/marketing/StoryboardStudio.tsx`

Main work:
- Add workflow tab state.
- Replace `ColumnFrame` layout with clearer step panels.
- Add progress summary cards.
- Add next-step helper text.
- Redesign `ShotScriptCard`, `ShotPromptCard`, and `ShotBoardCard`.
- Improve responsive spacing and readability.

Optional supporting imports:
- Use existing UI components already in the project where helpful, such as:
  - `Tabs`
  - `Card`
  - `Badge`
  - `Separator`

---

## Result

The Storyboard Studio will feel like a guided production board instead of a confusing control panel:

```text
Header + progress
Next recommended action
Step tabs
Focused workspace
Readable shot cards
Clear image storyboard
```

The user will be able to understand where they are, what exists, and what to click next without needing to decode the interface.


## Updated plan: keep the Marketing prompt planner simple and familiar

### Goal

Add cover visual generation inside the Marketing tab, but make the prompt planner match the existing prompt planners already used elsewhere in the app:

```text
[Prompt writer model selector] [Generate Prompt]

[Prompt textarea]

[Generate image]
```

No complex form fields. No separate “purpose / mood / include / avoid” planner.

---

## 1. Add front cover generation to the Marketing tab

### File

- `src/features/project/marketing/CoverAndVisuals.tsx`

### What will change

The **Cover & visuals** panel will get a dedicated **Front cover** generation area.

It will use the same backend path as the Overview cover generator:

```ts
target: "project-cover"
category: "cover"
aspect: "portrait"
```

So a cover generated from Marketing updates the real project cover used by:

- Overview
- Dashboard thumbnail
- Marketing preview

### UI

The front cover area will include:

```text
Front cover

[Current cover preview]

[Image model selector]

[Prompt writer model selector] [Generate Prompt]
[Prompt textarea]
[Generate / regenerate cover]
```

This will reuse the existing `PromptPanel` pattern instead of introducing a new custom planner layout.

---

## 2. Make the prompt planner “just like the others”

### File

- `src/features/project/marketing/CoverAndVisuals.tsx`

### Updated approach

The Marketing cover prompt planner will use the existing `PromptPanel` component, the same way the app already does for:

- Overview cover
- Suspects
- Hints
- Media images

It will have:

- a text area where you can write or edit the prompt
- a model selector for the prompt-writing model
- a **Generate Prompt** / **Revise Prompt** button
- a final **Generate image** button

### Behavior

The text area content becomes the prompt used for generation.

The prompt writer model selector controls which model drafts the prompt, matching existing planner behavior.

Generated prompts and images continue to be saved through the existing prompt/image history system.

---

## 3. Keep extra marketing image generation separate

### File

- `src/features/project/marketing/CoverAndVisuals.tsx`

The existing **Add marketing image** flow will remain for extra promotional/supporting visuals.

The panel will be clearer:

```text
Cover & visuals

A. Front cover
- Generates/regenerates the actual project cover

B. Marketing asset gallery
- Extra generated marketing images
```

This prevents confusion between “replace the real cover” and “generate another marketing asset.”

---

## 4. Make Script → Prompts reversible in Storyboard Studio

### File

- `src/features/project/marketing/StoryboardStudio.tsx`

The current Script tab button will become a true toggle.

Before:

```text
Send to Prompts
```

After the shot is in the prompt queue:

```text
Remove from Prompts
```

Clicking it once sends the shot in. Clicking it again removes it.

### Removal behavior

Removing a shot from Prompts will:

- set `in_prompts: false`
- set `in_storyboard: false`
- keep the shot text
- keep any drafted prompt text
- keep any generated keyframe URL in the saved shot data, but hide it from the active board until the shot is sent back in

This makes the workflow reversible without destroying work.

---

## 5. Make Prompts → Storyboard reversible

### File

- `src/features/project/marketing/StoryboardStudio.tsx`

The Prompt tab button will also become a true toggle.

Before:

```text
Send to Storyboard
```

After the shot is on the board:

```text
Remove from Storyboard
```

Clicking once sends it in. Clicking again removes it.

### Removal behavior

Removing from Storyboard will:

- set `in_storyboard: false`
- keep the video prompt
- keep any generated keyframe URL
- simply hide the shot from the active storyboard board

---

## 6. Add a direct remove action on storyboard cards

### File

- `src/features/project/marketing/StoryboardStudio.tsx`

Each storyboard card will include:

```text
Remove from board
```

This gives a quick one-click way to take a shot off the storyboard without returning to the Prompts tab.

---

## 7. Update labels and progress text

### File

- `src/features/project/marketing/StoryboardStudio.tsx`

The progress summary and next-step helper will be adjusted so the reversible workflow is clear:

```text
Shots drafted
Prompts queue
Prompt text ready
On storyboard
Keyframes generated
```

Buttons will use plain, readable labels:

```text
Send to Prompts
Remove from Prompts

Send to Storyboard
Remove from Storyboard
```

---

## Files to edit

- `src/features/project/marketing/CoverAndVisuals.tsx`
  - Add real front-cover generation from Marketing.
  - Reuse the existing `PromptPanel` style.
  - Include a prompt text area, prompt-writer model selector, Generate Prompt button, image model selector, and Generate Cover button.
  - Keep extra marketing image generation separate.

- `src/features/project/marketing/StoryboardStudio.tsx`
  - Make Script → Prompts a one-click in/out toggle.
  - Make Prompts → Storyboard a one-click in/out toggle.
  - Add Remove from board on storyboard cards.
  - Preserve existing prompt/keyframe data when toggling out.

No database migration is required.

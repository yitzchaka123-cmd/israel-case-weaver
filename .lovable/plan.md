
## Bring back Marketing + Storyboard, and make back-cover images manageable

### What happened

The Marketing work is still in the codebase and the database tables still exist:
- `MarketingSection`
- `CoverAndVisuals`
- `BoxCopyPanel`
- `BarcodeAndBackPanel`
- `StoryboardStudio`
- `project_marketing`
- `project_storyboards`

But the project workspace tab bar currently does **not** include a Marketing tab, and `MarketingSection` is not mounted anywhere in `ProjectWorkspace`. That’s why you don’t see the storyboard / marketing area even though the files and records are still there.

The back-cover generator also currently behaves like a single-output slot: it generates one back cover and stores the active URL in `project_marketing.back_cover_url`. It does create a media asset behind the scenes, but the UI does not expose a proper back-cover candidate gallery.

---

## Fix 1 — Restore the Marketing tab

In `src/features/project/ProjectWorkspace.tsx`:

1. Import `MarketingSection`.
2. Add a Marketing tab to the main tab list, likely between **Hints** and **Media**:
   - Label: `Marketing`
   - Icon: `Megaphone` or `Clapperboard`
3. Add a matching `TabsContent` block:
   - Renders `<MarketingSection projectId={projectId} />`
4. Extend the workspace realtime invalidation to include:
   - `project_marketing`
   - `project_storyboards`
   - `media_assets`

Result: the Marketing area comes back, including:
- Cover & visuals
- Box copy
- Barcode & back-of-box
- Company profile summary
- Storyboard Studio

---

## Fix 2 — Back cover should support multiple images, not just one

In `src/features/project/marketing/BarcodeAndBackPanel.tsx`:

### Current behavior
- Generate one back cover.
- Save the active URL to `project_marketing.back_cover_url`.
- The UI only shows that one active back cover.

### New behavior
Add a back-cover candidate gallery.

Each generated back-cover image will be stored as a `media_assets` row with:
- `category: "marketing-back"`
- `title: "Back of box"`
- `url`
- `prompt`
- model/provenance fields already returned by `generate-image`

`project_marketing.back_cover_url` remains the selected/active final back cover.

### UI changes

The back-cover panel will show:

```text
Back cover

[Active selected back-cover preview]

Back-cover candidates
[thumb] [thumb] [thumb] [thumb] [+ Generate more]

Each candidate:
- Preview image
- Generated title/model badge if available
- “Use as active”
- “Open”
- “Delete”
- Prompt available/viewable
```

### Generate multiple options

Add a small control near the generate button:

```text
Generate options: [1] [2] [4]
```

Default: `4`

When the user clicks **Generate back-cover options**, the app will:
1. Generate the requested number of back-cover variations.
2. Bake the barcode into each one.
3. Save each variation as a `media_assets` row.
4. Automatically set the first/newest one as the active back cover.
5. Show all generated options in the candidate gallery.

### Add/remove behavior

- **Add**: generate more candidates at any time.
- **Remove**: delete a candidate from `media_assets`.
- If the deleted candidate is the active `project_marketing.back_cover_url`, the UI will either:
  - switch active to the next available back-cover candidate, or
  - clear the active back cover if none remain.

No database schema change is needed.

---

## Fix 3 — Make back-cover images visible in the broader Marketing visuals area

In `src/features/project/marketing/CoverAndVisuals.tsx`:

1. Update the marketing asset category filter to include `marketing-back`.
2. Label those assets as back-cover candidates rather than generic marketing extras.
3. Keep delete/open controls consistent with the back-cover panel.

This means back-cover images are visible both:
- inside the dedicated **Barcode & back of box** panel, and
- in the broader **Cover & visuals** marketing asset gallery.

---

## Fix 4 — Preserve prompts for later use

Back-cover candidates already go through `generate-image`, which stores:
- the prompt on `media_assets.prompt`
- the generation history in `media_assets.prompt_history`
- the model/provenance fields

The UI will expose the prompt from the candidate card, so you can reuse or copy it later.

For each back-cover candidate card:
- Add a **View prompt** or **Copy prompt** action.
- Keep prompt persistence tied to the saved media asset.

---

## Files to edit

- `src/features/project/ProjectWorkspace.tsx`
  - Restore the Marketing tab and mount `MarketingSection`.

- `src/features/project/marketing/BarcodeAndBackPanel.tsx`
  - Add multi-image candidate gallery.
  - Add generate-count control.
  - Generate 1/2/4 back-cover options.
  - Save every generated option as a `media_assets` candidate.
  - Add use-active/delete/open/copy-prompt controls.

- `src/features/project/marketing/CoverAndVisuals.tsx`
  - Include `marketing-back` assets in the visuals gallery.
  - Display them as back-cover candidates.

No database migration is required.


## Add a richer Box Text section under Cover & Visuals

### Goal

Replace the current simple “Box copy” panel with a professional packaging text planner for the front and back of the game box.

The new section will be called:

```text
Box Text
```

It will sit directly under **Cover & Visuals** and will be split into:

```text
Front cover text
Back cover text + QR
```

This focuses only on the box text/packaging copy area, not the broader cover image generation work.

---

## 1. Rename “Box copy” to “Box Text”

### File

- `src/features/project/marketing/BoxCopyPanel.tsx`

### Change

Rename visible UI labels:

```text
Box copy → Box Text
Save copy → Save box text
Draft all with assistant → Draft all box text
```

The panel description will explain that this text is meant for professional front/back game box layout.

---

## 2. Expand the front cover text fields

### Current front fields

```text
Tagline
Front subtext
```

### New front cover section

```text
Front cover text

Game title lockup note
- Optional note for how the title should appear visually.

Tagline under title
- Short line directly under the game name.

Front hook / subtext
- 1–2 lines selling the case premise.

Bottom explanation
- Short explanation near the bottom of the front cover, e.g. “A boxed detective mystery with documents, envelopes, and hidden evidence.”

Company slogan
- Pulled from company profile when available, editable per project.

Logo / brand note
- Shows the company logo from the company profile if available.
- Includes a note that the logo should be included on the front cover layout.
```

The company logo itself already lives in the company profile, so the Box Text panel will reference it and show a small preview instead of duplicating uploads.

---

## 3. Expand the back cover text fields

### Current back fields

```text
Back headline
Back body
```

### New back cover section

```text
Back cover text

Back headline
- Big hook at the top of the back box.

Short teaser
- 1–2 sentence cinematic setup.

Main back description
- Longer sales copy explaining the game.

What’s in the box
- Bulleted/line-based list: documents, envelopes, evidence, props, QR preview, etc.

How to play
- Short explanation of the player experience.

Feature bullets
- 3–5 selling points for the back cover.

Age / duration / players
- Packaging metadata, editable.

Spoiler-safe warning / content note
- Optional caution or tone note.

Company/legal/footer text
- Pulled from company profile when available, editable per project.
```

This gives the back cover enough structure to feel like a real professional game box instead of one paragraph.

---

## 4. Add a QR code area for mini movie previews

### File

- `src/features/project/marketing/BoxCopyPanel.tsx`

Add a **Mini movie preview QR** block inside the back cover section.

### Fields

```text
Mini movie preview URL
QR label
QR helper text
```

Example:

```text
Mini movie preview URL:
https://...

QR label:
Watch the mini movie preview

QR helper text:
Scan to watch the cinematic case teaser.
```

### QR behavior

- If a URL is entered, the app generates a QR code preview.
- The QR image is saved to the backend.
- The saved QR URL is stored with the project’s marketing data.
- The QR code is included in export.
- The QR code can later be used by the back cover visual generator.

If there is no mini movie URL yet, the UI will show a friendly placeholder asking for the preview link.

---

## 5. Add AI generation for the new fields

### Files

- `src/features/project/marketing/BoxCopyPanel.tsx`
- `supabase/functions/generate-marketing-copy/index.ts`

Each new field will keep the familiar behavior:

```text
[Generate] / [Regenerate]
```

There will also be grouped buttons:

```text
Draft front cover text
Draft back cover text
Draft all box text
```

The generation function will be updated so it can return the expanded fields.

The assistant will use:
- project title/subtitle
- genre, setting, difficulty, player role
- document/envelope counts
- selling point
- company profile
- age rating / legal text where available

---

## 6. Save all new Box Text fields

### Database change required

The current `project_marketing` table only has:

```text
tagline
front_subtext
back_headline
back_body
barcode_url
barcode_value
back_cover_url
copy_origins
```

To save the richer box text, add new nullable columns to `project_marketing`:

```text
front_title_note
front_bottom_explanation
front_company_slogan
front_logo_note

back_teaser
back_whats_in_box
back_how_to_play
back_feature_bullets
back_specs
back_content_note
back_footer_text

mini_movie_url
qr_label
qr_helper_text
qr_code_url
```

Existing projects will keep working because the new fields are nullable.

The existing `copy_origins` JSON will continue tracking which fields were AI-generated.

---

## 7. Generate and store the QR code

### Files

- `src/features/project/marketing/BoxCopyPanel.tsx`
- Optional helper file: `src/features/project/marketing/qr.ts`

Implement a lightweight QR generator for the mini movie URL.

Storage path:

```text
media/{projectId}/marketing/qr/mini-movie-preview.png
```

Save the public QR image URL into:

```text
project_marketing.qr_code_url
```

This avoids needing a separate QR table.

---

## 8. Include Box Text and QR in export

### File

- `src/lib/export.ts`

Update full project export to include:

```text
packaging/
  box-text.json
  box-text.txt
  qr/
    mini-movie-preview.png
```

The readable `box-text.txt` will be organized like:

```text
FRONT COVER TEXT
Title note:
Tagline:
Front hook:
Bottom explanation:
Company slogan:
Logo note:

BACK COVER TEXT
Headline:
Teaser:
Main description:
What's in the box:
How to play:
Feature bullets:
Specs:
Content note:
Footer text:

MINI MOVIE QR
URL:
Label:
Helper text:
QR image:
```

This makes the packaging copy easy to hand to a designer or print workflow.

---

## 9. Keep the UI clear and not overwhelming

### UI layout

Inside `BoxCopyPanel.tsx`, use two clear cards:

```text
Box Text

[Draft all box text]

Front cover text
- fields
- company logo preview
- Draft front cover text

Back cover text + QR
- fields
- QR preview/generator
- Draft back cover text

[Save box text]
```

Use larger text areas for longer back-cover fields and compact inputs for short packaging metadata.

---

## Files to edit

- `src/features/project/marketing/BoxCopyPanel.tsx`
  - Rename panel.
  - Split into front/back sections.
  - Add new packaging text fields.
  - Show company logo/slogan/legal references.
  - Add mini movie QR URL fields and QR preview.
  - Save expanded box text.

- `supabase/functions/generate-marketing-copy/index.ts`
  - Support expanded front and back packaging fields.
  - Add grouped generation: front, back, all.

- `src/lib/export.ts`
  - Export box text as JSON and TXT.
  - Export mini movie QR image.

- New helper if needed:
  - `src/features/project/marketing/qr.ts`
  - Generate QR image client-side before upload.

- Database migration:
  - Add nullable columns to `project_marketing` for the new box text and QR fields.


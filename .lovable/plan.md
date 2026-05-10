## Goals

1. Merge **Front cover** + **Back cover** into ONE unified "Box Cover" panel with a single Generate button + a **View Prompt** dialog showing the exact mega-prompt sent to ChatGPT.
2. Pull **QR codes** out into their own dedicated Packaging sub-panel (kept — only the *mention* of the QR in the printed Contents is removed).
3. Move **Company Profile** to the bottom of the Packaging page.
4. Remove the **mini-movie QR** concept entirely (not the real QR codes).
5. Keep `address` and `legal_text` in Settings → Company Profile, **per brand**, and make sure they're attached to the back-cover generation prompt.
6. Rewrite the **Contents** field so it lists actual game components by type + quantity (e.g. "25 evidence documents · 10 interrogation scripts · 5 photos · 3 maps"), driven per-case by what the writer actually generates. The contents string must NOT mention QR codes.
7. Remove the sticky **"Box Text · Cover Visuals · Barcode · …"** sub-nav bar in the Packaging page — it's just a long scroll now.
8. Pass the **QR PNG and EAN-13 barcode PNG** as additional reference images to ChatGPT in the cover-pair generation (in addition to the brand reference + 4 in-game scenes), so layout placement is respected.
9. Keep the **marketing-extras** image manager (extra promo images) on the Box Cover panel as a collapsed sub-section.

---

## Packaging page — new layout

```
[ Page header ]
   (no sticky sub-nav — just scroll)

1. Box Cover  (front + back combined)
   ├── Left: copy fields
   │     • Front: Title (read-only), Tagline, Bottom paragraph, Design notes
   │     • Back: Headline, Teaser → QR, Main description, Contents (auto-built),
   │             Age/Duration/Players, Legal/footer text
   │     • In-game scenes (4) — embedded
   │     • EAN-13 barcode (value + Generate/Regenerate)
   │     • Brand reference image picker
   ├── Right: Front | Back preview side-by-side
   │     + carousel of every prior front/back pair (click to restore)
   │     + actions: [Generate front + back] [View prompt] [Re-bake overlays]
   └── Marketing extras (collapsed sub-section, kept)
2. QR Codes  (dedicated panel — primary + secondaries, labels, target URLs, PNG previews)
3. Storyboard Studio
4. Company Profile  (brand selector + brand preview, moved to bottom)
```

---

## "View Prompt" dialog

Triggered by a button next to Generate front + back.

Shows:
- The exact `combinedPrompt` string we send to `generate-cover-pair` (composed via `composeCoverPairPrompt`)
- Thumbnails of all attached reference images, in the same order ChatGPT sees them:
  1. Brand reference image
  2. 4 in-game scenes
  3. Primary QR PNG  ← newly attached
  4. EAN-13 barcode PNG  ← newly attached
- A note listing post-generation bake overlays (title, tagline, specs badge, logo, real QR PNG stamped over the reserved zone, real EAN-13 stamped over the reserved zone)
- Copy-to-clipboard button

---

## Contents field — auto-built per case

Replace the free-text `back_whats_in_box` editing flow with an auto-composed string built from what the case actually contains. Pull live counts from the project's own data:

| Component | Source |
|---|---|
| Evidence documents | `documents` table where category = evidence/case-doc/forensics/etc. |
| Interrogation scripts | `documents` where category = interrogation/script |
| Photos | `media_assets` where category = envelope-photo / scene-photo |
| Maps / floorplans | `documents` where category = map |
| Envelopes | `envelopes` table count |
| Suspect dossiers | `suspects` table count |
| Hints | `hints` table count |

(Exact category mapping confirmed against the schema during build.)

UI:
- "Contents" row shows the auto-built string ("25 evidence documents · 10 interrogation scripts · 5 photos · 3 maps · 4 envelopes …") with a refresh icon
- An **override** textarea is available if the writer wants to hand-edit; otherwise the auto string is what bakes onto the back cover and what goes into the prompt
- The composer **strips any QR-code mention** — QR codes are not a printed component

Persisted to `project_marketing.back_whats_in_box` so existing bake/prompt code keeps working unchanged.

---

## QR codes panel (unchanged in concept, just relocated)

- Primary QR + secondary QRs (label, target URL, generated PNG) — full manager kept
- Mini-movie QR sub-card removed (`mini_movie_url`, `qr_label`, `qr_helper_text`, `qr_code_url` fields no longer surfaced or written by the marketing-copy edge function; DB columns retained, no migration)

---

## Company Profile (Settings) — address + legal stay, per brand

- Keep `address` and `legal_text` fields in `CompanyProfilePanel` so each brand stores its own
- `composeBackPrompt` already reads `company.address` and `company.legal_text`; verify they're included in every back-cover generation and surface them in the read-only "Brand footer preview" inside Box Cover
- The brand selector in Box Cover sets `projects.company_profile_id`, which drives which brand's address/legal/logo gets baked + sent to ChatGPT

---

## Files to touch

- `src/features/project/PackagingSection.tsx` — remove sticky nav bar; reorder sections; drop `BarcodeAndBackPanel` import; add `QrCodesPanel` and reorder.
- `src/features/project/packaging/BoxCopyPanel.tsx` → refactored into `BoxCoverPanel.tsx`: merges front+back text, in-game scenes, EAN-13, brand-ref picker, paired generate button, View Prompt dialog, paired-cover carousel, marketing-extras sub-section, auto-built Contents.
- `src/features/project/packaging/CoverAndVisuals.tsx` — its "generate front+back" + carousel logic merges into `BoxCoverPanel`; file deleted (or thinned to the marketing-extras section that gets imported by BoxCoverPanel).
- `src/features/project/packaging/BarcodeAndBackPanel.tsx` — deleted.
- `src/features/project/packaging/QrCodesPanel.tsx` — NEW (extracted multi-QR manager).
- `src/features/project/packaging/composeContents.ts` — NEW: builds the "25 evidence documents · …" string from project data.
- `src/features/project/packaging/composePrompts.ts` — drop mini-movie references; keep address/legal in back-prompt; mention the new QR + barcode reference images in the brand-continuity preface.
- `supabase/functions/generate-cover-pair/index.ts` — accept `qrImageUrl` + `barcodeImageUrl` in body and append them to the FormData refs.
- `supabase/functions/generate-marketing-copy/index.ts` — stop generating mini-movie/removed fields; stop generating `back_whats_in_box` (now auto-built).
- `src/features/settings/CompanyProfilePanel.tsx` — leave address + legal as-is (no removal).

No DB migrations.

---

Ready to build on approval.

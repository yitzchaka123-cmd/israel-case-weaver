## Goal

Upgrade the **Solution video URL (final envelope QR)** block in the envelope editor (`src/features/project/EnvelopesSection.tsx`, lines ~653–669) from a bare input + helper text into a polished QR control card. The QR remains final-envelope only. The composited print QR is unchanged — this plan focuses on the editor UI.

## What changes

### 1. New component: `FinalEnvelopeQrCard`

Co-located inside `EnvelopesSection.tsx` (or split into `src/features/project/envelopes/FinalEnvelopeQrCard.tsx` if it grows). Replaces the current `<Label> + <Input> + <p>` block.

**Layout (single rounded card, two columns on ≥sm, stacked on mobile — viewport is 647px so stacked on phone):**

- **Left / top — URL controls**
  - Section title: "Final envelope QR" with a small QR icon.
  - One-line description: "Scanned by the player after the verdict to watch the cinematic news report."
  - URL input with inline status badge:
    - empty → muted "Add a link"
    - invalid URL → destructive "Invalid URL"
    - valid non-YouTube → warning "Link saved (not a YouTube URL)"
    - valid YouTube → success "YouTube link ready"
  - Action row: **Test scan** (opens URL in new tab, disabled until valid), **Copy URL**, **Clear**.

- **Right / bottom — Live QR preview**
  - Renders QR client-side via the existing `qrcode` package already used in `src/features/project/marketing/qr.ts` (no new dep).
  - ~160px square, white background, rounded border, subtle shadow.
  - Below QR: small monospace truncated URL, "Scan to watch" helper.
  - Empty state: dashed placeholder + "Live preview appears here".
  - Debounced render (200ms) so typing doesn't thrash.

### 2. Theme-aware styling note for the AI page mock-up

The user picked **"Match envelope era/theme automatically"** for the printed QR card on the page. The current `pageInsertPrompt` in `EnvelopesSection.tsx` line 120 hardcodes a generic frame. Update that single prompt line so it tells the image model to derive the QR card's visual treatment (paper texture, border style, label typography, tape/stamp accents) from the envelope's own era/genre established by the rest of the design instructions, instead of dictating a fixed look. Keep all structural rules: bottom 35% of page, ~5×5cm QR, label, helper line, printed URL fallback.

### 3. Minor surrounding cleanup

- Remove the now-redundant standalone `<p>` helper text (folded into the new card).
- Keep `solution_video_url` field name and DB column unchanged — pure UI change.

## Files touched

- `src/features/project/EnvelopesSection.tsx`
  - Replace lines ~653–669 with `<FinalEnvelopeQrCard value={...} onChange={...} />`.
  - Add the component definition near the bottom of the file.
  - Tweak the `pageInsertPrompt` final-envelope branch (line 120) to make the QR card era/theme-adaptive instead of hardcoded.
- No DB migration. No new dependencies (`qrcode` already installed via marketing panel).
- No changes to the generator edge function or playbooks.

## Out of scope (per your answers)

- No real composited scannable QR on the exported page (still placeholder, composited at print time as today).
- No printable standalone QR card.
- No QR on box back or other envelopes.

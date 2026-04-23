

## Marketing tab + Company Profile + Storyboard generator

Adds a new **Marketing** tab to every case with everything you need to ship a boxed product and a 1–2 minute promo: cover art reuse, back-of-box generation with auto-barcode, marketing copy, a workspace-level **Company Profile** (legal/footer/etc.), and a **Storyboard Studio** that takes you Script → Prompts (Sora / Veo / Kling-ready) → visual storyboard.

### 1. New tab: Marketing

A 9th tab in the project workspace (`Megaphone` icon), placed after Media. Five stacked panels:

**Panel A — Cover & visuals**
- Reuses `projects.cover_image_url` (the cover already generated on Overview) — shows it large at the top.
- Grid of additional marketing images pulled from `media_assets` where `category` is one of: `cover`, `back`, `marketing-extra`. Each has the same Generate prompt → Generate image flow as the Media tab (reuses `PromptPanel` + `suggest-image-prompt` + `generate-image`).
- "Add marketing image" button → opens the same prompt panel scoped to a new `marketing-extra` category (no hard cap; you said "optional more than four").

**Panel B — Box copy**
- `front_subtext` (1–2 line teaser under the title on the front of the box)
- `back_headline` (the punchy line on the back)
- `back_body` (the full back-of-box paragraph)
- `tagline` (one-liner for ads / social)
- Each field has a **✨ Generate with assistant** button (calls a new `generate-marketing-copy` edge function that reads the case context and the playbook's marketing rules) and a **Regenerate** button. All fields are editable. All saved to a new `project_marketing` row.

**Panel C — Barcode + back of box**
- **Generate barcode** button → generates a unique EAN-13 (random + check digit) per project, renders the SVG client-side (no extra deps — small inline encoder), uploads PNG to the `media` bucket, stores the value + URL in `project_marketing.barcode_value` / `barcode_url`.
- Below it: small preview of the barcode + the digits.
- **Generate back cover image** button (only enabled after barcode + back copy exist) → calls `generate-image` with a composite prompt that bakes in the back headline, back body, tagline, and "place a barcode in the lower-right corner" instructions, then post-composites the actual barcode PNG into the lower-right via canvas before uploading. Stored as a `back` media asset and shown inline.

**Panel D — Company profile (read-only here)**
- Pulls from the workspace-level Company Profile (see section 3). Shows logo, company name, legal text, support email, website, address.
- "Edit in Settings" link.
- These values are auto-injected into the back-of-box generation prompt and the storyboard end-card.

**Panel E — Storyboard Studio** (see section 2 — full description below)

### 2. Storyboard Studio (mini-movie generator)

A 3-column workflow inside the Marketing tab. Designed to be visually beautiful — large cards, soft shadows, smooth column transitions.

**Column 1 — Script**
- Length selector chips: **30 s / 60 s / 90 s / 120 s** (drives shot count: ~6 / 10 / 14 / 18 shots).
- "Script instructions" textarea (per-case overrides — e.g. "open on a close-up of the locket").
- **Generate script** button → calls `generate-storyboard` edge function with `mode: "script"`. Returns a structured screenplay: `[{ shot, duration_s, action, voiceover, on_screen_text }]`. Rendered as a clean numbered list with editable fields per shot.
- Per-shot ➜ button to push that shot into Column 2.
- **Push all shots →** moves the entire script into Column 2 prompts.

**Column 2 — Visual prompts**
- Two prompt-instruction textareas always visible at the top:
  - **Sora instructions** (style + camera language for Sora 2)
  - **Kling 3 instructions** (style + camera language for Kling 3)
  - (Easy to add more engines later — the dropdown next to each shot picks which engine's prompt to generate.)
- Each shot card shows: thumbnail slot, action/VO from script, dropdown (Sora 2 / Kling 3), **Generate prompt** button.
- The edge function (`mode: "prompt"`) takes the shot + chosen engine instructions + the case context and returns an engine-specific prompt. Editable.
- **Push to storyboard →** sends the shot+prompt into Column 3.

**Column 3 — Visual storyboard**
- Grid of shot cards, each with: shot number, duration bar, the prompt, and a thumbnail.
- **Generate keyframe** button per shot → uses `generate-image` (Nano Banana 2 by default) to create a single still illustrating that shot, stored as `marketing-storyboard` media asset linked back to the shot.
- "Generate all keyframes" runs them sequentially.
- Each card stays editable (re-generate prompt, re-generate image, re-order with drag handles).
- Export buttons: **Copy all prompts** / **Download storyboard PDF** (shots + thumbs + prompts) — PDF reuses the existing `export.ts` jsPDF setup.

**Saved state**: the entire storyboard (length, instructions, shots, prompts, image refs) lives in `project_storyboards` with one row per project (latest one shown; "New version" button keeps history).

### 3. Workspace-level Company Profile

Created **once per workspace** in Settings, used by every case.

- New section in `SettingsPage.tsx` titled **Company profile** (above "AI provider routing").
- Fields: company name, tagline, legal blurb (e.g. "© 2026 Acme Mysteries Ltd."), support email, website, address, country, age rating, "made in", company logo upload (reuses the `logos` storage bucket), social handles (instagram/x/tiktok/youtube — optional).
- Stored in a new `company_profiles` table keyed by `owner_id` (one row per user).
- Marketing tab pulls this and shows the read-only summary; back-of-box and storyboard end-card automatically include the legal blurb and logo.

### Database changes (one migration)

```text
company_profiles
  owner_id uuid pk → auth.users
  company_name, tagline, legal_text, support_email,
  website, address, country, age_rating, made_in,
  logo_url, social jsonb default '{}'
  created_at, updated_at
  RLS: Auth all * (matches existing project tables)

project_marketing
  project_id uuid pk → projects
  front_subtext, back_headline, back_body, tagline,
  barcode_value text, barcode_url text,
  back_cover_url text,
  copy_origins jsonb default '{}'  -- which fields were AI-generated
  created_at, updated_at
  RLS: Auth all *

project_storyboards
  id uuid pk
  project_id uuid → projects
  length_seconds int (30|60|90|120)
  script_instructions text, sora_instructions text, kling_instructions text
  shots jsonb  -- [{ id, n, duration_s, action, voiceover, on_screen_text,
                --    engine, prompt, image_url, image_asset_id }]
  status text default 'draft'
  created_at, updated_at
  RLS: Auth all *
```

Also extends the allowed values of `media_assets.category` informally (it's free text already) with `marketing-extra`, `marketing-back`, `marketing-storyboard`.

### Edge functions

| Function | Purpose |
|---|---|
| `generate-marketing-copy` *(new)* | Reads project + company profile + playbook marketing rules, returns `{ front_subtext, back_headline, back_body, tagline }` (or a single field when `field` arg is set). Routes via `ai-router.ts`. |
| `generate-storyboard` *(new)* | Two modes: `mode:"script"` returns the full shot list for the chosen length; `mode:"prompt"` returns an engine-specific (Sora 2 / Kling 3) video prompt for one shot. Routes via `ai-router.ts`. |
| `generate-image` *(extended)* | Accepts an optional `composite` arg `{ overlay_url, position: "bottom-right", scale: 0.18 }` and bakes the overlay into the final PNG before uploading — used to stamp the barcode onto the back-of-box image. |

No new external API keys — all routing through your existing Lovable AI / OpenAI / Gemini providers.

### Playbook integration

`AssistantPlaybookPanel` and `assistant-playbook.ts` get a new section **Marketing rules** with editable defaults the marketing-copy and storyboard generators read on every call:
- Back-of-box body length (e.g. 60–90 words)
- Tagline rules (length, voice)
- Content the back must always include (player count, age, play time, contents list — auto-derived from envelopes/docs counts)
- Storyboard tone defaults (e.g. "noir trailer with quick cuts, no dialogue, music-led")
- Sora vs Kling style presets
All editable per workspace; the case-level instructions in the Marketing tab override them.

### Notification triggers

`triggers.ts` gets two new rules:
- `barcode_generated` → assistant pings *"Barcode is ready — generate the back cover next."*
- `storyboard_script_ready` → assistant pings *"Script's drafted — review it before I write the visual prompts."*

### Files added / edited

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | `company_profiles`, `project_marketing`, `project_storyboards` + RLS + realtime. |
| `src/features/project/MarketingSection.tsx` *(new)* | Top-level Marketing tab container. |
| `src/features/project/marketing/CoverAndVisuals.tsx` *(new)* | Panel A. |
| `src/features/project/marketing/BoxCopyPanel.tsx` *(new)* | Panel B. |
| `src/features/project/marketing/BarcodeAndBackPanel.tsx` *(new)* | Panel C. EAN-13 generation + back-of-box composite. |
| `src/features/project/marketing/CompanyProfileSummary.tsx` *(new)* | Panel D (read-only view of workspace profile). |
| `src/features/project/marketing/StoryboardStudio.tsx` *(new)* | Three-column storyboard workflow. |
| `src/features/project/marketing/ean13.ts` *(new)* | Tiny EAN-13 encoder + SVG renderer. |
| `src/features/settings/CompanyProfilePanel.tsx` *(new)* | Workspace company profile form (Settings). |
| `src/features/project/ProjectWorkspace.tsx` | Add Marketing tab. |
| `src/features/settings/SettingsPage.tsx` | Add Company profile section. |
| `src/lib/assistant-playbook.ts` + `supabase/functions/_shared/assistant-playbook.ts` | Marketing rules section. |
| `src/features/settings/AssistantPlaybookPanel.tsx` | UI for the new playbook section. |
| `supabase/functions/generate-marketing-copy/index.ts` *(new)* | AI marketing-copy function. |
| `supabase/functions/generate-storyboard/index.ts` *(new)* | AI script + per-shot prompt function. |
| `supabase/functions/generate-image/index.ts` | Optional `composite` overlay support for barcode-on-back-cover. |
| `src/features/project/notifications/triggers.ts` | Two new triggers. |

### Visual style

All Marketing panels use the same card / soft-shadow language as existing tabs. The storyboard board is the showpiece — large rounded cards, 16:9 thumbnail slots, subtle column dividers, smooth fade-in when shots arrive in a new column, color-coded engine pills (Sora purple, Kling teal). Mobile: columns stack with sticky headers.

### Out of scope (good follow-ups)

- Actually rendering the videos (you said you'll do videos later — we save the prompts for hand-off).
- Multiple barcode formats (UPC-A, ISBN). EAN-13 only for v1.
- Per-shot voiceover TTS preview.
- A "company profile per case" override (today everything inherits from the workspace profile).


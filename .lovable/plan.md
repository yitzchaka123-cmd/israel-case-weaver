
# Packaging stage — plan

This plan covers three things you asked about:

1. The flow once documents + envelopes are done (assistant hands off → hints → packaging).
2. Renaming "Marketing" to "Packaging" and reordering the panels.
3. Rebuilding the front-cover design flow around a **reference cover** stored on a **company profile**, with multiple profiles per user (so English & Hebrew companies can coexist).

---

## 1. Stage handoff (assistant behavior)

No new tab — just a new prompt-side rule for the assistant:

- When all envelopes are `status = 'final'` (or all docs final + all envelopes have a cover image), the assistant proactively says: *"Documents and envelopes are done. Next stage is **Hints** — want me to draft the hint sheets?"*
- When all hint sheets exist and have content, the assistant says: *"Hints are done. Next stage is **Packaging** — should I start with the box text?"* and links/scrolls into the Packaging tab.
- These are added as two new beats in `_shared/assistant-playbook.ts` (stage transitions section). No DB changes.

---

## 2. Tab rename + panel reorder

**Rename Marketing → Packaging everywhere:**

- Tab label, section heading, in-app copy.
- Route segment: `MarketingSection.tsx` → `PackagingSection.tsx`, folder `src/features/project/marketing/` → `src/features/project/packaging/`.
- Anchor IDs renamed (`marketing-cover-visuals` → `packaging-cover-visuals`, etc.).
- Wherever code references "marketing" as a *category* on `media_assets` (e.g. `marketing-extra`, `marketing-back`) we **leave the DB strings alone** — those are data, not UI. Only UI labels change. (Keeps history intact.)
- The project tab in `ProjectWorkspace` updated to "Packaging".

**New panel order in the Packaging tab:**

```text
1. Box Text                  ← was #2, now first
2. Barcode + Back of box     ← was #3
3. Cover & Visuals           ← was #1, moves down
4. Company Profile           ← unchanged position-wise (4)
5. Storyboard Studio         ← unchanged (5)
```

The sticky sub-nav at the top reflects the new order.

---

## 3. Front cover design model — the big one

You asked: *is the assistant the graphic designer?* Answer in this plan: **yes, but anchored to a reference cover** you pick from a company profile. Concretely:

### 3a. Reference covers live on Company Profiles

- A user can have **multiple company profiles** (e.g. "Acme EN", "אקמה HE").
- Each profile has its existing fields **plus**:
  - `language` (e.g. `English`, `Hebrew`) — drives copy language for that brand.
  - `is_default` (boolean).
  - `reference_covers` — a small gallery (1–6 images) the user uploads of real game boxes whose design language they want to emulate. Each entry: `{ url, label, design_notes }`.
  - `cover_design_brief` — long-form text the user writes once: "Our covers always use heavy serif title, muted noir palette, photo-real central object, brand bar at the bottom…"

### 3b. Project picks which profile to use

- `projects.company_profile_id` (nullable FK to a row in the new `company_profiles` table layout).
- A picker in Project Overview (and at the top of the Packaging tab) lets you switch which profile this case ships under. Falls back to the user's default profile if unset.
- Box-text generation, back-of-box, storyboard end-card, and the front cover all read this profile instead of the current `owner_id`-only lookup.

### 3c. Front cover generation flow (new)

The Cover & Visuals panel keeps its current bake-on-overlay (so title/tagline stay crisp), but the **prompt building** changes:

1. User picks one of the profile's reference covers (or "no reference, free design").
2. Assistant composes the cover prompt from:
   - The reference cover image (passed as a vision reference into ChatGPT image edit / Gemini).
   - The profile's `cover_design_brief`.
   - The case's `front_title_note` (the unified "title lockup graphic-design brief" — see 3d).
   - Tagline + `front_subtext` (acting as the front hook, per your answer).
   - Project facts (mystery_type, setting, era, etc.).
3. Generation uses ChatGPT Image-2 (already wired) with the reference image as input → produces a cover that mimics layout/typography hierarchy of the reference but with this case's art.
4. The bake step then overlays the actual title/tagline text crisply (current pipeline).

### 3d. "Game title lockup note" becomes a unified design brief

Per your description, `front_title_note` is **one** graphic-design instruction that covers:

- How the title should feel (typography family, weight, treatment).
- How the tagline directly under it should sit (size relationship, alignment, color).
- Where the front hook goes relative to the lockup.

Field stays single-input but its label/helper updates to: *"Title + tagline + hook lockup brief — graphic design instructions for the whole top-of-cover wordmark group."*

`tagline` and `front_subtext` (the hook) remain as separate **copy** fields — the design brief just tells the designer how to lay them out together.

### 3e. Box Text panel becomes the entry point

- Box Text is now panel #1. Its "Draft all box text" button is the natural first action when entering Packaging.
- After drafting, a small banner at the bottom suggests: *"Box text ready → next: Barcode & back, then Cover."*

---

## Technical section

### DB migration

```sql
-- New table: many profiles per user
create table public.company_profiles_v2 (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,            -- "Acme EN"
  language text not null default 'English',
  is_default boolean not null default false,
  -- all existing company_profiles fields copied:
  company_name text, tagline text, legal_text text, support_email text,
  website text, address text, country text, age_rating text, made_in text,
  logo_url text, phone text, vat_number text, manufactured_by text,
  distributed_by text, warning_text text, box_footer_line text,
  social jsonb not null default '{}'::jsonb,
  -- new fields:
  reference_covers jsonb not null default '[]'::jsonb,  -- [{url,label,design_notes}]
  cover_design_brief text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.company_profiles_v2 enable row level security;
-- RLS: owner_id = auth.uid() for select/insert/update/delete.

-- Project link
alter table public.projects add column company_profile_id uuid;
-- + a function-side migration that copies the user's existing
--   company_profiles row into one v2 row marked is_default=true,
--   then links existing projects to it.

-- Selected reference cover per project (optional)
alter table public.projects
  add column cover_reference_url text,
  add column cover_reference_notes text;
```

We keep the old `company_profiles` table around read-only for a release, then drop it.

### Code changes

- `src/features/settings/CompanyProfilePanel.tsx` → list view of profiles, "Add profile", per-profile editor with reference-cover uploads + design brief.
- New hook `useActiveCompanyProfile(projectId)` used by Box Copy, Cover & Visuals, Back/Barcode, Storyboard.
- `src/features/project/MarketingSection.tsx` → renamed/moved to `packaging/PackagingSection.tsx`, panels reordered.
- `ProjectWorkspace.tsx` tab label "Marketing" → "Packaging", route param value updated.
- `CoverAndVisuals.tsx`: add reference-cover picker (reads `reference_covers` from active profile), pass selected reference URL to the image function as a vision reference, include `cover_design_brief` in `composeFrontPrompt`.
- `generate-marketing-copy` edge function: accept `companyProfileId`, use that profile's language to write copy in the correct language.
- `_shared/assistant-playbook.ts`: add stage-transition beats (envelopes done → hints; hints done → packaging starting at box text).

### Out of scope for this plan (call out separately if you want them)

- Auto-translating one profile's copy into the other language.
- Per-profile pricing / SKU defaults.
- Sharing reference covers across profiles.

---

If this matches what you want, approve and I'll implement in this order: migration → settings multi-profile UI → tab rename + reorder → cover reference picker + prompt rebuild → assistant stage-transition beats.

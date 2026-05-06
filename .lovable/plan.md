## Goal

In-world documents from a fictional agency, company, lab, newspaper, precinct, etc. should all carry an invented logo/letterhead lockup, and every document from the same source should reuse the SAME invented logo so the prop set looks like it came from a real organization. Real-world brands stay forbidden.

Today the prompts actively block this — `generate-document` says "No logos" / "no logos of real companies" without distinguishing fictional ones, and the envelope brief says "Never invent real institutional emblems or signatures" which the model interprets as "no emblems at all."

## Changes

### 1. `supabase/functions/generate-document/index.ts` — image prompt (lines ~575–595)

Replace the blanket no-logo rule with an explicit "invent a fictional logo" rule for in-world props:

- Add a new `BRANDING / LOGO` section to the non-Doc-0 prompt:
  - If the document originates from an institution (police precinct, crime lab, hospital, morgue, newspaper, courier company, bank, school, government office, private firm, etc.), the page MUST carry a small invented logo / crest / wordmark / letterhead lockup at the top, plus matching footer mark when appropriate (file code, dept name).
  - The logo must be 100% fictional — no real-world brands, no real police/agency seals, no real newspaper mastheads, no copyrighted marks. Style it period- and setting-appropriate (1950s county shield, 1970s monoline wordmark, modern flat mark, etc.).
  - When `design_instructions` already names a specific organisation logo (see #3), render exactly that lockup. Otherwise invent one that fits the org named in the document.
- Keep Doc 0 (plain inventory sheet, lines 547–569) unchanged — it stays logo-free.
- Tighten the existing rule on line 592 to: `Do NOT use logos of REAL companies, real police departments, real news outlets, or any real-world emblem. Invented fictional logos for the in-world agencies are REQUIRED, not forbidden.`

### 2. `supabase/functions/_shared/assistant-playbook.ts` — envelope brief (line 178)

Change the trailing sentence from `Never invent real institutional emblems or signatures.` to `Use invented fictional emblems and signatures for in-world agencies — never copy or imitate real-world institutional emblems, real police seals, or real signatures.` and update line 164 so the top-zone logo is REQUIRED (not "optional") whenever the page comes from an institution.

### 3. `supabase/functions/_shared/assistant-playbook.ts` — new "Fictional Brand Kit" rule

Add a short playbook section (near the existing C.1 / H consistent-set rules) telling the assistant to:

- Identify each recurring in-world organisation in the case (e.g. "Precinct 14", "St. Marlow Forensics Lab", "The Daily Ledger", "Kessler & Sons Couriers").
- For each one, draft a one-paragraph **brand kit** (logo concept, wordmark, color, typography, era cue) and stash that paragraph at the top of the `design_instructions` of every document that comes from that org. Example: `BRAND KIT — Precinct 14: gold-trimmed navy shield with oak-leaf border, wordmark "PRECINCT 14 — METRO POLICE", serif type, 1970s municipal vibe. Reuse this exact lockup on every Precinct 14 document.`
- The three already-consistent families (Interrogations, Police Reports, Intake Reports) inherit the precinct brand kit automatically. Standalone one-offs (lab report, autopsy, news clipping, courier receipt) must each call out their own org's brand kit when they have one.
- Reinforce: never invent a real-world brand, never reuse the same fictional logo across two different in-world orgs.

### 4. Documentation

Update `.lovable/plan.md` with a one-paragraph note describing the fictional-logo rule so future passes don't re-block it.

## Files touched

- `supabase/functions/generate-document/index.ts` (image prompt only)
- `supabase/functions/_shared/assistant-playbook.ts` (envelope brief + new brand-kit section)
- `.lovable/plan.md`

No DB, no UI, no new edge functions.

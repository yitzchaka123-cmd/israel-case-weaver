# Fictional logos on in-world documents

Goal: every document from a recurring in-world organisation (precinct, lab, newspaper, courier, etc.) carries an INVENTED logo / wordmark, and all docs from the same org share it. Real-world brands and real seals stay forbidden.

## Edits

1. `supabase/functions/generate-document/index.ts` (image prompt) — replaced the "no logos" line with a `BRANDING / LOGO (REQUIRED)` block and explicit "invented logos required, real-world emblems forbidden" rule. Doc 0 inventory sheet still stays logo-free.

2. `supabase/functions/_shared/assistant-playbook.ts` (envelope brief) — top-zone logo is REQUIRED with a reused fictional lockup; trailing "never invent emblems" sentence flipped to "use INVENTED fictional emblems, never imitate real ones".

3. `supabase/functions/assistant-chat/index.ts` — added rule **I. FICTIONAL BRAND KIT**: assistant must catalog each in-world org and prepend a one-paragraph brand kit (logo concept, palette, type, era) to every `design_instructions` from that org so all its docs render with the same lockup.

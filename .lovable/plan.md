# Envelopes rewrite + News Report tab + QR library

## 1. Envelope spec rewrite

Update both `supabase/functions/_shared/assistant-playbook.ts` (the playbook the assistant follows) and `supabase/functions/generate-envelopes/index.ts` (the deterministic generator) so every project produces exactly **5 envelopes** with this structure.

### Envelope #0 — Welcome / Briefing
- Atmospheric in-world opening: greet the player as the investigator, set the scene (case name, location, victim, why you've been called in). Length: assistant-decided, but **not too short** — minimum ~4 sentences of atmosphere, can go longer for harder cases.
- Ends with the **first task** on its own line, formatted as **bold red Hebrew** (already styled by `EnvelopesSection.tsx` via the `task` field).
- No recap here — this is the first envelope.

### Envelopes #1, #2, #3 — Task Gates
Each of these envelopes has the **same fixed structure**, in this order:

1. **Recap of the previous task's findings (MANDATORY on every envelope after #0)** — 2–4 sentences in the in-world investigator voice, summarising what the player just discovered by completing the previous envelope's task. Pattern:
   > "מצאת את X, שהוביל אותך אל Y, וגרם לך להבין ש-Z."
   > ("You found X, which led you to Y, and made you realise Z.")
   The recap **must reference concrete details** from the case's logic flow (specific clues, suspect names, evidence, statements) — not generic filler. It must logically follow from the **previous envelope's `task`** so the player feels a continuous narrative thread: task → discovery → recap → next task.

2. **Next task** — one short, clear, imperative Hebrew sentence (≤18 words), rendered as **bold red** via the `task` field. This is the only thing the player needs to "do" with this envelope.

3. **Optional bonus clue** — the assistant decides per case whether **0, 1, or 2** of envelopes #2/#3 also carry a bonus clue (e.g. "we brought suspect X back for re-interrogation — here is their new statement", or a forensic memo, or a newly-found note). Bonus clue appears **after** the bold red task, clearly separated, formatted as a short in-world document snippet.

### Envelope #4 — Solution
1. **Final recap (MANDATORY)** — same voice and structure as the other recaps, 2–4 sentences summarising what the previous task uncovered and how it points to the culprit. Continues the narrative thread from envelope #3's task.
2. **Solution reveal** — short paragraph naming the culprit, motive, method, and how the clues line up.
3. **Congratulations line** in bold red.
4. **QR code placeholder** — reserved 4×4 cm space on the printed envelope template with helper text "סרקו את הקוד לצפייה בדיווח החדשותי על הפענוח" ("Scan the code to watch the news report on the case being solved"). The actual QR image will be bound from the QR library (see §3).

### The "narrative chain" rule (new)
The generator and the assistant must treat envelopes as a **chain**: when writing envelope N's recap, look at envelope N-1's `task` and write the recap as the in-world result of having performed that task. A reader going envelope-by-envelope should experience one continuous detective story:

```text
#0 briefing → first task
#1 recap of what #0's task uncovered → next task
#2 recap of what #1's task uncovered → next task (+ optional bonus clue)
#3 recap of what #2's task uncovered → next task (+ optional bonus clue)
#4 recap of what #3's task uncovered → solution + QR
```

### Implementation details
- In `assistant-playbook.ts`, expand the `Envelopes` section of the system prompt with the structure above, the chain rule, and one explicit worked example showing recap → bold red task → optional bonus clue across two consecutive envelopes.
- In `generate-envelopes/index.ts`:
  - Require an array of exactly 5 envelopes typed `briefing | task_gate | solution`.
  - For every envelope **except #0**, require a non-empty `recap` string. Validate that the recap references at least one named entity (suspect / clue / location) from the project's logic flow.
  - Generate envelopes **sequentially** (not in parallel), passing the previous envelope's `task` into the prompt for the next envelope so the recap is grounded in what the player actually just did.
  - Continue to populate the existing `task` field (keeps the bold-red rendering in `EnvelopesSection.tsx` unchanged).
  - Add an optional `bonus_clue: { title, body }` per task_gate, with the assistant deciding 0–2 across envelopes #2/#3.
  - Add an optional `qr_placeholder: { helper_text, target_qr_id? }` on the solution envelope.
- No DB migration needed for envelope content itself — the `envelopes` table already stores arbitrary fields. Just enrich the JSON shape and update the renderer in `EnvelopesSection.tsx` to display `recap` (normal weight, italic, above the bold-red task), and `bonus_clue` below the task in a bordered card.

## 2. News Report tab under Marketing

Add a new tab **"דיווח חדשותי" / "News Report"** to `src/features/project/MarketingSection.tsx`, alongside the existing Mini-Movie storyboard.

- New edge function `supabase/functions/generate-news-report/index.ts`:
  - Input: `project_id`.
  - Reads `solution_summary`, suspects, and key logic-flow nodes.
  - Generates a short in-world TV news report: anchor intro script (Hebrew), 4–6 shot-by-shot storyboard (location, on-screen text, B-roll suggestion, anchor VO line), and an outro.
  - Persists into `project_storyboards` with a new `kind` column (`'mini_movie' | 'news_report'`), and a new `video_url` column for the user to paste their final rendered video link.
- New UI panel `src/features/project/marketing/NewsReportPanel.tsx`:
  - "Generate news report" button (calls the edge function).
  - Renders the anchor script + storyboard table.
  - Field for the user to paste the final rendered video URL (`video_url`).
  - "Create QR code for this report" button → opens the QR library (see §3) prefilled with the `video_url` as the target.
- Migration:
  - `ALTER TABLE project_storyboards ADD COLUMN kind text NOT NULL DEFAULT 'mini_movie' CHECK (kind IN ('mini_movie','news_report'));`
  - `ALTER TABLE project_storyboards ADD COLUMN video_url text;`

## 3. Reusable QR Code library

A per-project library of QR codes the user can generate, label, and reuse anywhere (final envelope, marketing materials, etc.).

- New table `project_qr_codes`:
  - `id uuid pk`, `project_id uuid`, `label text`, `target_url text`, `png_path text` (path in `media` bucket), `size_px int default 512`, `created_at`, `updated_at`.
  - RLS: same `Auth all *` pattern as other project_* tables.
- New panel `src/features/project/marketing/QrLibraryPanel.tsx` (rendered as another tab in MarketingSection):
  - List existing QR codes (label + preview + target URL + copy/download buttons).
  - "Add QR code" form: label, target URL → generates a 512×512 PNG client-side using the existing `src/features/project/marketing/qr.ts` helper, uploads to the `media` bucket, inserts row.
  - Edit / delete actions.
- Bind to final envelope:
  - On envelope #4, add a small "Linked QR code" selector listing rows from `project_qr_codes`. The chosen `qr_id` is stored on the envelope under `qr_placeholder.target_qr_id`; the print layout in `EnvelopesSection.tsx` swaps in the actual PNG when present, and otherwise renders the placeholder box.
- Assistant tool:
  - Add `bind_news_report_qr({ envelope_index, qr_id })` to `assistant-chat/index.ts` so the assistant can wire a generated QR to the final envelope from chat.

## 4. Files changed / created

**Edited**
- `supabase/functions/_shared/assistant-playbook.ts` — new envelope spec (recap chain + bold red task + optional bonus clue + QR placeholder).
- `supabase/functions/generate-envelopes/index.ts` — sequential generation, enforced `recap` field on envelopes #1–#4, `bonus_clue`, `qr_placeholder`.
- `supabase/functions/assistant-chat/index.ts` — add `bind_news_report_qr` tool; keep existing empty-board approval guard.
- `src/features/project/EnvelopesSection.tsx` — render `recap` (italic, normal weight) above the bold-red `task`, render `bonus_clue` card below, render QR slot on the solution envelope.
- `src/features/project/MarketingSection.tsx` — add "News Report" and "QR Codes" tabs.

**Created**
- `supabase/functions/generate-news-report/index.ts`
- `src/features/project/marketing/NewsReportPanel.tsx`
- `src/features/project/marketing/QrLibraryPanel.tsx`
- Migration: add `kind` and `video_url` to `project_storyboards`; create `project_qr_codes` with RLS.

## 5. What you'll see

- Every envelope #1–#4 opens with a short in-world recap of what the previous task uncovered ("You found X → which led to Y → which made you realise Z"), then gives the next task in bold red Hebrew. Read end-to-end, the five envelopes form one continuous detective story.
- Envelopes #2 and #3 may include a bonus clue (re-interrogation note, lab memo, etc.) — assistant picks 0–2 per case.
- Envelope #4 ends the game with a final recap, the solution, congratulations in bold red, and a QR code slot.
- A new **News Report** tab in Marketing generates an in-world TV news storyboard for the case solution and lets you paste the final rendered video URL.
- A new **QR Codes** tab lets you generate, label, and reuse QR codes (including binding one to the final envelope to point at your news report video).
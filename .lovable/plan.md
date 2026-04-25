# Re-model: All documents from the start, envelopes are task gates

## Current model (what's wrong)
The assistant playbook + tooling currently treats envelopes as **sequential physical containers**:
- Envelope #0 opens the game and "hands off the first task"
- Envelopes #1..#N each "confirm the previous task succeeded and hand off the next task"
- Documents are assigned an `envelope_number` so the player only sees a few documents at first, then more as they open later envelopes
- Doc 0 (contents checklist) is grouped "by envelope/section"

## New model (what you want)
- The player opens the box and **immediately has access to ALL documents** (organized by Doc 0).
- **Envelopes are not document containers** — they are **sealed task/reveal envelopes**.
- The player only opens envelope #N **when they reach the matching beat in the case** (e.g. "Open envelope 2 when you've identified the murder weapon"). Inside is a task, a reveal, or a new instruction — never the next batch of evidence.

This is a meaningful shift across the assistant prompt, the document/envelope schema usage, the canvas arrangement, and the box copy.

---

## Scope of changes

### 1. Assistant playbook (rewrite envelope semantics)
Files: `supabase/functions/_shared/assistant-playbook.ts` and the mirrored `src/lib/assistant-playbook.ts`

- Rewrite the `envelopes` block + `renderEnvelopesLine` + `renderEnvelopeDesignTemplate` so the description tells the model:
  - Envelopes are **sealed task gates**, not document distribution batches.
  - Every envelope has an **opening trigger** (the case beat that unlocks it: e.g. "after suspect X is cleared", "after the cipher in Doc 7 is solved", "after the autopsy timeline is reconstructed") and a **payload** (a short task, a reveal, a deduction nudge, or an end-of-game accusation).
  - Envelope #0 is the **mission briefing** — opened first, before anything else. It introduces the case and points the player at Doc 0 (contents).
  - The final envelope contains the **accusation form / solution reveal**.
  - Envelopes do **not** contain documents and must not gate document access.
- Update the `envelopes.closing_line_he` framing so the closing line still matches the new "you've completed this beat → continue investigating with the documents you already have" tone.

### 2. Doc 0 (contents checklist) wording
Files: `supabase/functions/assistant-chat/index.ts` (Phase 4 system prompt + Doc 0 hard rule), `_shared/assistant-playbook.ts` (universal_documents Doc 0 purpose)

- Rewrite Doc 0's purpose: it's the **single master inventory of every document in the box**, organized by topic / type / case area (NOT by envelope). It also lists the sealed envelopes as separate items with their **trigger conditions** (no spoilers).
- Remove "group by envelope/section when useful" — replace with "group by topic, document type, or investigative area; list envelopes separately as sealed items with their trigger conditions."

### 3. Document → envelope linkage (deprecate `envelope_number` for distribution)
Schema does not need to change. The column `documents.envelope_number` becomes **optional metadata only** (used for legacy projects); it must NOT drive what the player can see. Changes:

- **Assistant prompt** (`assistant-chat/index.ts`):
  - Phase 3/4 system prompt: stop instructing the model to assign documents to envelopes for distribution. Documents may still reference a logic-flow node, but `envelope_number` should default to `null` and only be set when the user explicitly wants a document to be **physically tucked inside** a task envelope (rare).
  - `propose_document_set` tool description: drop "the planned envelope" requirement; replace with "the related case beat / logic-flow node ids."
  - `add_document` / `update_document` tool docs: clarify that `envelope_number` is optional and not a distribution gate.
- **`create-final-documents-map`** edge function: stop arranging documents under envelope parents in the Final Flow; arrange them under their logic nodes / suspects / case beats instead.

### 4. Envelope generation (new task-gate prompt)
File: `supabase/functions/generate-envelopes/index.ts`

- Rewrite the system prompt:
  - Each envelope's `task` field is the **task/reveal/instruction the player reads when they open it at the right moment** — short, bold, in-language, never "go open the next envelope to get more evidence."
  - Envelope #0 is the mission briefing; final envelope is the accusation/solution reveal; middle envelopes are tied to specific case beats from the Logic Flow.
  - Add a new field per envelope in the tool schema: **`trigger_he`** (or `opening_trigger`) — a 1-sentence description of when the player should open this envelope (e.g. "Open after you've narrowed it to two suspects"). Persist this in `envelopes.notes` (existing column) or extend with a dedicated column.
  - Stop telling the model to reference `documents.envelope_number` as the source of envelope contents; instead pass the Logic Flow beats + suspects.

### 5. Envelopes UI tweaks
File: `src/features/project/EnvelopesSection.tsx`

- Add a **"Opening trigger"** field per envelope row (saved to `envelopes.notes` if we don't add a column, or to a new dedicated field).
- Soften the existing "Linked documents" picker into an **optional** "Physical inserts (rare — items literally sealed inside this envelope)" with helper copy explaining that the default is **no documents inside**; documents live in the box, not the envelopes.
- Update the section header copy to: "Sealed task envelopes — opened only when the player reaches the matching beat."

### 6. Canvas / Smart Arrange
File: `supabase/functions/arrange-canvas/index.ts` + `src/features/project/CanvasSection.tsx`

- Update the AI lane prompt: envelopes are **not** the spine that documents stack under. Instead:
  - **Documents lane** is independent and groups by suspect / topic / logic node.
  - **Envelopes lane** sits on the side as sealed gates pinned to the logic beat that unlocks each one (drawn with a labeled edge to that beat, e.g. "trigger: ...").
- Update the deterministic fallback layout the same way.

### 7. Box copy & marketing
Files: `supabase/functions/generate-marketing-copy/index.ts`, `src/features/project/marketing/BoxCopyPanel.tsx` (the "What's in the box" / "How to play" text)

- Update the model instructions for `back_how_to_play` and `back_whats_in_box` to describe the new flow:
  - "All case documents are in the box from the start, organized by Doc 0."
  - "Sealed envelopes are opened only when you reach the moment marked on each one — they contain a task or a reveal, never new evidence to read at random."

### 8. Notification / phase wording
Files: `src/features/project/notifications/triggers.ts`, `PhaseStatusBar.tsx`

- Update any user-facing copy that describes envelopes as "the next batch of documents" → "sealed task gates."

### 9. Migration data hygiene (lightweight, optional)
- One-time script (no schema migration): for any existing project still using the old model, leave `documents.envelope_number` untouched (it doesn't break anything) but the new prompts will stop relying on it. Existing envelopes retain their `task`/`label`; the new "opening trigger" field starts empty and the user fills it via the assistant or manually.

---

## What is explicitly NOT changing
- The 5-envelope (or playbook-configured count) structure stays.
- The envelope cover image generation pipeline stays.
- The `documents.envelope_number` column stays (kept for backward compatibility + the rare "physical insert" case).
- The hint system, suspects, and document generation pipelines are untouched.

## Risk / things to confirm with you after approval
- Should the "opening trigger" be stored in the existing `envelopes.notes` column, or do you want a dedicated `opening_trigger` column? (I'd recommend a dedicated column for cleanliness — small migration.)
- For existing projects where docs were already assigned an `envelope_number`, do you want me to clear those assignments, or leave them alone and just stop using the field going forward? (I'd recommend leaving them alone — the new prompts ignore the field for distribution.)
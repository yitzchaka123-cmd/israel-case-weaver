## Goal

Realign the Logic Flow generator and the Envelopes UI with the agreed game-flow model:

- All documents live loose in the box from the start.
- Envelopes are **sealed task gates** — they describe a beat the player has reached, list which loose-pile clues are *relevant* to that beat, and give a short task. They do **not** "contain" clues.
- A true "drop inside the envelope" is reserved for ~1 envelope per game (a creative reveal — e.g. interrogation transcript) and only when the user explicitly opts in.

## Root causes (already located in code)

1. `supabase/functions/generate-logic-flow/index.ts` (lines ~121–122)
   - Forces every envelope node's `description` to use the 3-line format with a literal `Contains: …` line.
   - Tells the model to draw edges as "clue → envelope" / "deduction → envelope" (wording: *"which clues / deductions belong inside it"*).
2. `src/features/project/EnvelopesSection.tsx` (lines ~207, ~576, ~586, ~623)
   - Linked-documents picker uses copy like *"No documents inside"*, *"only items literally sealed inside this envelope"*, *"Default: empty. Documents live loose in the box."* — half of that is correct, half still nudges the old model.
   - The "Explain" prompt asks the AI "what should be **inside** it."
3. (Already correct, leave alone) `supabase/functions/assistant-chat/index.ts` and `supabase/functions/generate-envelopes/index.ts` already articulate the correct model.

## Changes

### 1. `supabase/functions/generate-logic-flow/index.ts`

Rewrite the envelope-description requirement to:

```
Task: <what the player physically does with this envelope>
Relevant clues / beat: <which loose-pile clues the player should already be holding / which deduction has just happened that unlocks this gate>
Why it matters: <how it advances the case structure / what it confirms or unlocks next>
```

Also rewrite the edges instruction:

- Replace *"draw edges showing which clues / deductions belong inside it (clue → envelope, deduction → envelope)"* with:
  *"For each envelope node, draw `supports` edges from the clues/deductions that the player should already have figured out from the loose document pile before this gate opens. The label on these edges MUST be `relevant to` (NOT `inside`, NOT `contains`). These edges represent the beat that triggers the envelope, not physical contents."*
- Keep `envelope_n → envelope_{n+1}` chain edges (label: `then`).
- Add a single explicit reminder: *"Envelopes do NOT contain documents. All documents are in the box from the start. Only the final envelope physically contains the accusation form."*

Apply the same wording fix in both branches (existing-envelopes branch and scaffolding branch around lines 121–122).

### 2. `src/features/project/EnvelopesSection.tsx`

Update copy in the Linked Documents card so it stops implying envelopes are document containers by default:

- Line ~207 (Explain prompt): *"Explain what each envelope's role is in THIS case, which clues from the loose document pile the player should already have when they open it, the task it gives, and the …"*
- Line ~576: *"No documents tucked inside (default — all docs live loose in the box from the start)"*
- Line ~586: *"Optional — only set this if you are physically sealing a document inside this envelope (rare, ~1 per game — e.g. a late interrogation reveal)"*
- Line ~623: *"Default: empty. All documents live loose in the box from the start. Use this only for the rare creative drop where you are physically sealing a document inside this envelope."*
- Rename the section header from "Linked documents" to **"Documents physically sealed inside (rare)"** to make the semantic crystal clear.

### 3. `supabase/functions/explain-canvas-node/index.ts` (envelope branch)

Audit and update the explanation prompt for envelope nodes so the AI explicitly explains:
- the **task** the envelope gives,
- which **loose-pile clues** the player should already be holding,
- the **beat** that unlocks it,
- and clarifies it is a gate, not a container.

(Will inspect this file during implementation; small wording change.)

### 4. Backfill existing envelope node descriptions (data fix)

Existing logic boards already on disk have the literal `Contains: …` line baked in. Two options — pick one during implementation:

- **(Preferred)** Add a one-time safe rewrite when the Logic Flow regenerates: when overwriting envelope nodes, the new prompt naturally replaces the description.
- For projects that won't regenerate soon, do nothing destructive — the new wording lands the next time the user re-runs Logic Flow. We will NOT mass-overwrite existing rows automatically.

### 5. Assistant-chat reinforcement (small)

Add one short line to the system prompt in `assistant-chat` so the assistant, when narrating an envelope to the user, never uses the word *"contains"* for clues — only for the rare physical drop. (Reinforces the rule we already have.)

## Out of scope

- No DB migrations.
- No changes to envelope generation (`generate-envelopes`) — it is already correct.
- No changes to the realtime live-dot work.

## Verification

After the change, ask the assistant to regenerate Logic Flow on a test project and confirm:

- Envelope node descriptions read `Task / Relevant clues / Why it matters` (no `Contains:`).
- Canvas edges into envelopes are labeled `relevant to`, not `inside`.
- Envelopes panel "Linked documents" card defaults to empty and the helper copy reads as a rare exception.
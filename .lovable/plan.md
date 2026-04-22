

## Wire the assistant's approved summary into the Logic Flow

### The problem (what I found in the code)

When you approve the case narrative in the Assistant, it calls a tool called `set_solution_summary` that writes the text to `projects.solution_summary`. This is the same field the Case Board's **Solution summary** button reads from — so that button already shows the approved text correctly.

But the **Generate logic flow** button is disconnected from that pipeline:

- `supabase/functions/generate-logic-flow/index.ts` builds its prompt from title/setting/suspects only. It **never reads `project.solution_summary`**, so the model has no idea what narrative you already approved.
- After the model invents its own clues + summary, the function **overwrites** `projects.solution_summary` with that newly-invented text — wiping the version you approved in the assistant.
- The Logic Flow toolbar gives no visual hint that an approved summary already exists, or that clicking Generate will replace it.

### What changes

**1. `generate-logic-flow` edge function — use the approved summary as the source of truth**

Add a new mode driven by a `useExistingSummary` flag (default `true` when `solution_summary` is non-empty):

- If a `solution_summary` exists, prepend it to the user prompt as **`APPROVED SOLUTION (source of truth — your flow MUST match this exactly)`**, and instruct the model: *do not invent a different culprit, motive, or chain — only break the approved narrative into clues, deductions, red herrings, and edges that prove it.*
- After generation, **only overwrite `solution_summary`** when the user explicitly asked for a fresh case (`useExistingSummary: false`). When using the approved summary, leave the existing text untouched and instead store the model's expanded version in a new optional field `logic_flow_notes` (or just discard it — the canonical text stays the assistant's).

**2. `CanvasSection.tsx` — make the connection visible and controllable**

In the Logic Flow toolbar, when `project.solution_summary` exists:

- Replace the bare "Generate logic flow" button with a small grouped control:
  - Status chip: *"Using approved summary from Assistant"* (green dot, links to open the Solution summary dialog read-only).
  - Primary button: **Generate from approved summary** (calls function with `useExistingSummary: true`).
  - Dropdown menu next to it with the alternative: *Generate fresh (ignore summary)* — shows a confirm dialog warning that the approved text will be replaced.
- When no `solution_summary` exists yet, show today's button label but with a hint: *"Tip: approve a Phase 2 summary in the Assistant first for a flow that matches your narrative."*

**3. `CanvasSection.tsx` — preserve the summary on regenerate**

The current `generateLogicFlow` opens the Summary dialog after generation and overwrites the textarea with whatever came back. Change it so:
- When `useExistingSummary` was true, the dialog opens with the **unchanged** approved text (no surprise edits).
- When `useExistingSummary` was false, behave as today (show the new model-generated summary).

**4. Pass the request through end-to-end**

`CanvasSection` → POST `{ projectId, replace,
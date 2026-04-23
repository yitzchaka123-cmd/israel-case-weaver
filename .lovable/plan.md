

## Finish the Envelopes upgrade (UI + canvas wiring + notifications)

Backend, schema, edge functions, and playbook are done. This wraps up the remaining frontend pieces so you can actually use everything.

### 1. `EnvelopesSection.tsx` — full redesign

Replace the current bare-bones section with a two-column card per envelope:

**Above the grid (global actions row)**
- **Brief me on envelopes** button → fires `mystudio:assistant-prompt` with the playbook briefing prompt (lists count + labels + closing-line rule, asks which envelope to draft first).
- **✨ Generate all envelopes with AI** button → calls the new `generate-envelopes` edge function, shows spinner, toasts on success.

**Per envelope card — left column (content)**
- Label (Hebrew, RTL) — kept
- Task (Hebrew, RTL, bold red) — kept
- **Linked documents** multi-select — writes both `envelopes.linked_document_ids` and `documents.envelope_number`
- Internal notes — kept
- Status pill + tooltip explaining `draft / in_progress / review / final` (production status used by the Production Dashboard, NOT envelope state)
- `AssistantOriginBadge` for `created_by_message_id`

**Per envelope card — right column (design & generation, NEW)**
- **Design instructions** textarea (large, monospace) — placeholder explains paper stock / wax seal / Hebrew label placement / classification look
- **✨ Draft prompt** button → `suggest-image-prompt` with `category: "envelope"`, fills the textarea
- **Generate envelope mock-up** button → `generate-image` with `category: "envelope"` + `envelope_id`, stores URL into `envelopes.cover_image_url`, auto-bumps status to `review`, shows thumbnail
- **Open in Assistant ↗** button → fires `mystudio:assistant-prompt` with a per-envelope starter prompt (label + task + asks assistant to brief playbook rules for this envelope)

### 2. `CanvasSection.tsx` — pre-flight banner

Above the "Generate logic flow" button, show an amber banner when **no envelope has `design_instructions` filled** yet:

> ⚠ You haven't briefed the envelopes yet. The flow will be more accurate if you walk through the {N}-envelope structure with the assistant first. **[Open assistant briefing]**

Banner button fires the same "Brief me on envelopes" prompt. Banner hides once any envelope has design instructions.

### 3. `notifications/triggers.ts` — `envelopes_drafted` trigger

Add a new trigger that fires when all envelopes have non-empty `task` AND `design_instructions`:
> "Envelopes are drafted — generate the logic flow next so they get wired into the board."

Wired into the existing `useProjectNotifications` polling loop next to `documents_drafted`.

### 4. `CanvasNodeTypes.tsx` — render envelope nodes

Add an `envelope` node renderer (purple/wax-seal styled, mail icon, shows envelope number + label) so the new envelope nodes the logic-flow generator now produces actually display correctly on the canvas.

### Files touched

| File | Change |
|---|---|
| `src/features/project/EnvelopesSection.tsx` | Full redesign (above) |
| `src/features/project/CanvasSection.tsx` | Pre-flight banner |
| `src/features/project/canvas/CanvasNodeTypes.tsx` | Envelope node renderer |
| `src/features/project/notifications/triggers.ts` | `envelopes_drafted` trigger |

### Out of scope

- Standalone envelope asset gallery (cover lives on the row).
- Print sheet PDF for envelopes (later).
- Per-project override of envelope count (workspace playbook still wins).


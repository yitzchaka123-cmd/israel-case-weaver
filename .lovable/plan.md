

## Envelopes upgrade: design instructions, generation, assistant link, logic-flow integration

Right now the Envelopes tab is the bare minimum: a label, a one-line task, free-text notes, and a status dropdown that does nothing useful. We'll bring it up to the same level as Documents and Suspects — full design control, AI generation per envelope, an assistant briefing step, and proper canvas integration.

### What "draft / in_progress / review / final" actually is (and why it feels broken)

It's a **production status** that the **Production Dashboard** and **phase status bar** read to count how much of Phase 5 (Envelopes) is done. It does NOT change anything inside the envelope itself. It's just a kanban-style flag so you can see at a glance which envelopes are still being worked on. We'll keep it but add a tiny tooltip explaining it, plus auto-bump it from "draft" → "review" when AI generates content (matching how Documents already works).

### 1. Schema additions

One migration extends `envelopes` so each row carries the same prompt-control surface as `documents`:

```text
envelopes
  + design_instructions text          -- visual / physical brief for the printed envelope (the "design instructions" you asked for)
  + cover_image_url      text         -- AI-generated mock-up of the sealed envelope front
  + linked_node_ids      uuid[]       -- envelopes referenced by which logic-flow nodes
  + linked_document_ids  uuid[]       -- which document rows belong inside this envelope (mirrors documents.envelope_number for free)
  + created_by_message_id uuid        -- so the AssistantOriginBadge "by assistant" pill works
```

No RLS change — table already has `Auth all *` policies. Realtime is already wired in `ProjectWorkspace`.

### 2. Envelopes tab — full redesign (`EnvelopesSection.tsx`)

Each envelope card becomes a two-column layout (mirrors `DocumentsSection` DocDialog patterns):

**Left column — content**
- Label (Hebrew, RTL) — unchanged
- Task (Hebrew, RTL, bold red) — unchanged
- **Linked documents** — multi-select of project docs that belong inside this envelope (writes both sides: `envelopes.linked_document_ids` and the existing `documents.envelope_number`)
- Internal notes — unchanged
- Status pill with a small "?" tooltip:
  > Draft = not started · In progress = being written · Review = AI just produced something, check it · Final = locked in for print.

**Right column — design & generation (NEW)**
- **Design instructions** textarea (large, monospace, like document design instructions). Pre-filled placeholder explains: paper stock, color, wax seal, stamp art, Hebrew label placement, classification look, etc. This is what the image generator reads.
- **✨ Draft prompt** button → calls existing `suggest-image-prompt` edge function with `category: "envelope"` and a hint built from the envelope's label + task + project context. Replaces the textarea content with a structured brief (re-using the same writer-model picker as Documents).
- **Generate envelope mock-up** button → calls existing `generate-image` edge function with the design instructions + envelope number, stores the URL in `envelopes.cover_image_url`, shows a thumbnail. Status auto-bumps to "review".
- **Open in Assistant ↗** button — fires the existing `mystudio:assistant-prompt` event with a starter prompt:
  > "Help me write envelope #N. Current label: '...'. Current task: '...'. Brief me on the playbook rules for this envelope, then propose a Hebrew label, task, and design direction."
  
  This is the "link to the AI chat where it would create these envelopes" you asked for.

**Above the grid — global actions**
- **Brief me on envelopes** button (left) — opens Assistant with this prompt:
  > "Walk me through the {N}-envelope flow from the playbook ({labels}). Explain what each envelope's role is in this case, what should be inside it, and the closing line rule. Then ask me which envelope you should help me draft first."
  
  This is the "assistant should brief me on the five envelopes from the playbook before creating the logic flow" requirement.
- **Generate all envelopes with AI** button (right) — calls a new `generate-envelopes` edge function that produces label + task + design_instructions for every envelope in one shot, using the playbook envelope rules, the case context, and the existing logic-flow / suspects / documents. Stamps `assistant_origins.envelopes` and writes one row per envelope (or updates if rows exist).

### 3. Logic-flow integration

Two changes so envelopes flow into the Case Board exactly like the user asked:

**A. Pre-flight briefing in the Logic Flow generator UI** — `CanvasSection`'s "Generate logic flow" button gets an info banner when envelopes haven't been drafted yet:
> ⚠ You haven't briefed the envelopes yet. The flow will be more accurate if you ask the assistant to walk you through the {N}-envelope structure first. **[Open assistant briefing]**

The button fires the same "Brief me on envelopes" prompt. This makes the assistant brief you on the envelopes **before** the logic flow gets generated.

**B. Envelopes become real nodes in the logic flow** — `supabase/functions/generate-logic-flow/index.ts`:
- Loads the project's `envelopes` rows alongside suspects.
- The system prompt gets a new "ENVELOPES (player-facing flow gates)" section listing each envelope's number / label / task / linked documents.
- The tool schema grows a required envelope row column on the right side of the canvas: each envelope becomes one `node_type: "envelope"` node, positioned in a vertical lane right of the solution, in numerical order.
- Edges: the model is instructed to draw `clue → envelope` and `deduction → envelope` edges showing which evidence belongs in which envelope, plus `envelope_n → envelope_n+1` chain edges so the player flow is visible.
- After insert, we write the new envelope-node ids back into `envelopes.linked_node_ids` so jumping from a node to its envelope row (and vice versa) works in a follow-up.

Net effect: every envelope you've drafted shows up as a colored node in the Logic Flow board, wired into the case, and reachable from the Final Flow as well (the same logic board powers it).

### 4. Assistant playbook — already covers this, plus one addition

The playbook already has an `envelopes` section (count, labels, closing line). We add ONE field so design briefs can be templated workspace-wide:

```ts
envelopes: {
  count, labels, closing_line_he,
  + design_brief_template: string   // default: a 4-paragraph stock brief describing kraft envelopes, wax-seal styling, Hebrew label placement, etc.
}
```

Surfaced in `AssistantPlaybookPanel.tsx` under the existing "Envelopes" section as a textarea. The Envelopes tab's "Draft prompt" button uses it as the seed when no per-envelope design exists yet.

### 5. New / changed files

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Add `design_instructions`, `cover_image_url`, `linked_node_ids`, `linked_document_ids`, `created_by_message_id` to `envelopes`. |
| `src/features/project/EnvelopesSection.tsx` | Full redesign: design instructions, draft-prompt + generate-image buttons, linked docs picker, status tooltip, "Brief me" + "Generate all envelopes" + per-envelope "Open in Assistant" buttons, origin badge. |
| `supabase/functions/generate-envelopes/index.ts` *(new)* | AI generator: produces all `count` envelopes' label + task + design_instructions in one structured tool call, using the playbook + project context + suspects + logic flow + documents. |
| `supabase/functions/suggest-image-prompt/index.ts` | Add `category: "envelope"` branch — uses the playbook envelope design template + envelope label + task as the seed. |
| `supabase/functions/generate-image/index.ts` | Accept `category: "envelope"` and store the image URL into `envelopes.cover_image_url` for that envelope row (mirrors how it currently stores into `documents`). |
| `supabase/functions/generate-logic-flow/index.ts` | Load envelopes; inject ENVELOPES block into the prompt; require envelope nodes + envelope chain edges; write back `envelopes.linked_node_ids`. |
| `supabase/functions/_shared/assistant-playbook.ts` & `src/lib/assistant-playbook.ts` | Add `envelopes.design_brief_template` field with a sensible default + a renderer for the prompt. |
| `src/features/settings/AssistantPlaybookPanel.tsx` | New textarea for the envelope design brief template. |
| `src/features/project/CanvasSection.tsx` | Pre-flight banner on "Generate logic flow" when no envelope has design_instructions yet, with "Open assistant briefing" button. |
| `src/features/project/notifications/triggers.ts` | New trigger `envelopes_drafted` → notification "Envelopes are drafted — generate the logic flow next so they get wired into the board." |

### Out of scope

- A standalone "envelope assets" gallery (the cover image lives on the envelope row itself).
- Auto-printing envelope sheets (Documents already has the PDF flow; envelopes can re-use it later).
- Variable envelope counts inside one project (the playbook controls count workspace-wide; per-project override is a follow-up).


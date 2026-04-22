

## What those badges are

Under each assistant reply, you may see small pills like `✓ add document`, `✓ add suspect`, `✗ generate image`. These are **tool-call receipts** — a log of every backend action the assistant performed in that turn (writing a document, adding a suspect, creating a canvas node, etc.). The ✓/✗ tells you whether each one succeeded.

They are *informational only* today. They look like buttons but do nothing on click — that's the confusion.

## Three ways to fix this — pick one

### Option A — Make them obviously non-interactive (smallest change)
Restyle the pills so they read as log entries, not buttons:
- Smaller, lighter, no border, muted text (e.g. `· added document · added suspect`)
- Group duplicates: `✓ added 4 documents, 2 suspects` instead of 6 separate pills
- Tooltip on hover shows the full action name + any returned message

Result: clear they're a status log, not controls. Zero new behavior.

### Option B — Make them actually useful (clickable shortcuts)
Each pill becomes a real link to the thing that was created/modified:
- `add_document` → opens that document in the Documents tab
- `add_suspect` → jumps to that suspect card
- `add_node` → focuses that node on the Canvas
- `generate_image` → opens the asset in Media

Failed ones (✗) get a "Retry" action and show the error reason in a tooltip.

Result: the receipts double as a fast jump-to-result navigation.

### Option C — Hide them by default, show on demand
Replace the row of pills with a single collapsible line:
`▸ 6 actions performed (5 ✓, 1 ✗)` → expands to the full list with the same Option B behavior inside.

Result: cleanest chat surface, full detail one click away.

## Recommendation

**Option C + B combined**: collapse by default to keep the conversation clean, and when expanded each item is clickable (jump-to-result for ✓, retry + error for ✗). Best of both — quiet UI, powerful when you need it.

## Files that would change

- `src/features/project/AssistantSection.tsx` — `MessageBubble` component (the `tools.length > 0` block, lines ~350–363) gets replaced with the new collapsible receipt component. No backend changes needed; the data is already there in `msg.metadata.tools`.

Tell me which option you want (A, B, C, or the C+B combo) and I'll build it.


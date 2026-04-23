

## Three small canvas polish fixes

### 1. Dotted background (so panning/zooming feels grounded)

The canvas currently uses React Flow's default `<Background>` in line variant with very subtle styling, which reads as a near-flat surface — there's no visual anchor when you pan or zoom.

Switch it to React Flow's built-in `BackgroundVariant.Dots` with a slightly larger gap and a higher-contrast dot color (`var(--color-muted-foreground)` at low opacity via `color-mix`) so motion is immediately readable, like Figma / n8n / Reactflow demo boards.

**File:** `src/features/project/CanvasSection.tsx` — change the existing `<Background gap={24} size={1} color="var(--color-border)" />` to use `variant={BackgroundVariant.Dots}`, `gap={20}`, `size={1.4}`, and a dot color computed via `color-mix(in oklab, var(--color-muted-foreground) 35%, transparent)`. Add `BackgroundVariant` to the existing `reactflow` import.

### 2. Auto-explain when a node is opened

Right now the AI explanation only renders after you click **Explain**. The plan: trigger `explain()` automatically the first time a node detail panel opens (per node), so the explanation is already there when you arrive. The manual **Regenerate** button stays for re-runs.

**File:** `src/features/project/CanvasSection.tsx` (`NodeDetailPanel`):

- Track per-node "already auto-explained" state with a `useRef<Set<string>>` so we don't re-fire on every re-render or when the user closes & reopens the same node within the session.
- In the existing `useEffect([nodeId])` that resets `explanation`, also check: if `nodeId` is set and we haven't auto-explained it yet, call `explain()` and add the id to the ref. Guard against running with no node id.
- The placeholder copy ("Click *Explain* for an AI breakdown…") stays as a fallback for when the call hasn't completed yet — replace it with a small inline "Generating explanation…" loader state when `explaining && !explanation` so the panel doesn't look empty during the ~2-4s call.
- The Explain button label stays as "Regenerate" once an explanation exists; before then it shows the spinner.

**Cost note:** every node click now spends one AI call against the user's selected Logic Flow model. That's expected per the user's request, and it only fires once per node per session (the ref dedupes).

### 3. Hide "Linked documents" on the Logic Flow board

On the Logic Flow board there are no documents yet (they're produced later from this very flow), so showing **Linked documents · 0** is just noise. The Suspects-in-linked-documents block is already conditional on `linkedSuspects.length > 0`, so it disappears on its own.

**File:** `src/features/project/CanvasSection.tsx`:

- Pass the current `board` prop down from `CanvasInner` to `<NodeDetailPanel>`.
- In `NodeDetailPanel`, only render the `Linked documents` `<PanelSection>` when `board === "final"`. The `linkedDocs` query can stay (cheap, scoped by `linked_node_ids` containment) — but skip it on the logic board with `enabled: !!nodeId && board === "final"` to avoid the wasted request.
- The "Documents" stat tile in the hero header should also hide on the Logic board, leaving just a single full-width "Suspects" tile (or, cleaner: drop the stats grid entirely on the Logic board since suspect counts there are also always 0 until docs exist). Simpler: render the stats grid only when `board === "final"`.

### What stays the same

- All existing behavior (drag, connect, arrange, generate logic flow, solution summary dialog, suspect chips on Final board) is untouched.
- No DB or edge function changes — `explain-canvas-node` already exists and is just being called automatically now.
- No new dependencies.


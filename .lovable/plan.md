

## Production status bar + locked Production fields + production dashboard

### 1. Sleek "Connected dots" status bar in the project header

A new horizontal phase tracker lives directly under the case title in `ProjectWorkspace.tsx`'s header — visible from every tab.

- Phases shown in order: **Setup → Summary → Structure → Documents → Envelopes → Hints → Packaging → Done**.
- Past phases: small filled emerald dot + faint emerald connector line.
- Current phase: slightly larger violet (accent) dot with a soft ring and bold label.
- Future phases: muted gray dots and gray connector lines.
- Whole bar sits in a subtle pill (`bg-muted/40`, rounded-full, border) so it reads as one cohesive widget.
- Each dot is a clickable button — click it to jump straight to that section's tab (e.g. Documents dot → Documents tab).
- Hovering a dot shows a tooltip with phase name + a one-line summary ("12 / 40 documents").
- Replaces the current `Phase · {project.phase}` chip, which becomes redundant.
- The existing `production` legacy phase value gets normalized to **Documents** (closest meaning) so existing projects display correctly.

```text
●━━━●━━━●━━━◉━━━○━━━○━━━○━━━○
Setup Sum Struct Docs* Env Hints Pack Done
```

### 2. Lock Production fields once set

In `ProjectOverview.tsx`'s **Production** panel:

- **Target document count**: editable only while it's null/empty. Once a number is saved it becomes read-only with a small lock icon and a one-line caption: *"Locked. Changing this would derail document numbering and envelope flow."* A tiny "Unlock" button next to the lock opens a confirm dialog (*"Are you sure? This can desync your production"*) for the rare override case.
- **Current phase**: select becomes a read-only display showing the current phase + a hint *"Phase advances automatically as the assistant moves you through Setup → Summary → Structure → … "*. No manual select.
- **Packaging notes**: hidden by default with a muted placeholder card: *"Packaging notes appear here when the assistant reaches the Packaging phase."* Reveals as a normal textarea once `phase === 'packaging' || phase === 'done'`.

### 3. Production dashboard inside the Production panel

Replace the current sparse Production grid with a real at-a-glance dashboard. Live counts come from a single small query using the existing realtime subscriptions (so it auto-refreshes when the assistant adds things).

Layout — 4 compact KPI tiles in a 2×2 grid on mobile / 4-up on desktop:

1. **Documents**: `12 / 40` with a thin progress bar underneath + tiny breakdown *"3 final · 9 draft"*.
2. **Suspects**: `5` with caption *"1 red herring"*.
3. **Canvas nodes**: `28` with caption *"Logic flow approved"* (green) or *"Logic flow pending"* (amber).
4. **Envelopes / Hints**: combined tile — `4 envelopes · 9 hints` with phase-colored dot.

Below the KPIs, a one-line **next-action hint** driven by phase:
- Setup → *"Open Assistant to confirm title and mystery type."*
- Structure → *"Jump to Case Board to approve the logic flow."*
- Documents → *"28 documents to go — open Assistant to keep generating."*
- etc.

Each KPI tile is clickable and routes to the relevant tab (Documents tile → Documents, Suspects → Suspects, etc.).

### 4. Files to change

- `src/features/project/ProjectWorkspace.tsx` — add `<PhaseStatusBar>` to the header, remove old Phase pill, normalize legacy `production` → `documents` for display.
- `src/features/project/PhaseStatusBar.tsx` (new) — the connected-dots component, clickable, with tooltips.
- `src/features/project/ProductionDashboard.tsx` (new) — KPI tiles + next-action hint, fetches counts via `useQuery` and listens for the same realtime invalidations already wired in.
- `src/features/project/ProjectOverview.tsx` — swap the old Production grid for `<ProductionDashboard>`, lock target doc count + phase, conditionally hide Packaging notes.

### Acceptance check

1. Header shows the connected-dots bar on every tab; current phase is highlighted in accent color.
2. Clicking the *Documents* dot jumps you to the Documents tab.
3. In Overview → Production, the target doc count field is read-only with a lock icon (because it's already 45 on your active project); same for the phase select.
4. Packaging notes section is hidden until phase reaches Packaging.
5. Production dashboard shows live `38 / 45` documents, `15` suspects, `92` canvas nodes, `0` envelopes / `3` hints — and they update without a refresh as the assistant adds more.


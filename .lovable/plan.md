

## Swap the Overview panel title font to Space Grotesk

Scope is tight: only the five panel titles on the Project Overview tab — **Case Identity, Case brief, Production, Cover, Autosave** — switch from Instrument Serif to Space Grotesk. Every other heading in the app (Documents, Suspects, Hints, Marketing, Assistant, Canvas, etc.) keeps the existing Instrument Serif.

### Changes

**1. `src/styles.css`**
- Add Space Grotesk to the Google Fonts `@import` line at the top of the file.
- Add a new utility class `.font-overview-title { font-family: "Space Grotesk", system-ui, sans-serif; letter-spacing: -0.01em; font-weight: 600; }` next to the existing `.font-display` rule.

**2. `src/features/project/ProjectOverview.tsx`**
- Update the `SectionTitle` helper (line 548–550) to use the new class:
  ```tsx
  <h2 className="font-overview-title text-xl mb-4">{children}</h2>
  ```
- All five Overview panel titles (`<SectionTitle>`) automatically pick this up — no other call sites exist for `SectionTitle`.

That's the entire change. Two files, surgical.


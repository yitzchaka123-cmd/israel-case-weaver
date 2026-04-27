# Fix: Prompt Studio missing from Settings sidebar

## What's wrong

The Prompt Studio section was wired up correctly inside `SettingsPage.tsx` (you can already reach it directly at `/settings#prompt-studio`), but the **left sidebar's settings menu lives in a different file** — `src/components/AppShell.tsx` — and that file has its own hardcoded list of section links that was never updated. So the section exists, it just has no link pointing to it.

The same file is also missing the "Visible models" entry that was added to `SettingsPage.tsx`.

## Fix

In `src/components/AppShell.tsx`, update the `settingsSections` array (lines 12–22) so it matches the real list of sections in `SettingsPage.tsx`:

- Add `{ id: "prompt-studio", label: "Prompt Studio" }` (between "Assistant rules" and "AI routing")
- Add `{ id: "visible-models", label: "Visible models" }` (between "AI routing" and "AI connections")
- Add `{ id: "team-access", label: "Team access" }` (after "Usage, credits…") — also missing from the sidebar

After this, refresh the page and Prompt Studio will appear in the left sidebar under Settings, right where you'd expect it.

## Follow-up housekeeping (optional but recommended)

Right now there are **two copies** of the settings section list — one in `AppShell.tsx` and one in `SettingsPage.tsx` — and they have already drifted apart twice. To prevent this from happening again, I'll export the `SETTINGS_SECTIONS` constant from `SettingsPage.tsx` and import it in `AppShell.tsx`, so there's a single source of truth.

Approve and I'll ship the fix.

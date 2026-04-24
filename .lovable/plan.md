## Reorder navigation: sidebar dropdowns plus a Marketing section menu

### Goal

Make navigation easier to scan by adding collapsible menus in the left sidebar and a cleaner internal menu inside the Marketing tab.

```text
Left sidebar
- Dashboard
  - Game A
  - Game B
  - Game C
- Settings
  - Branding
  - Appearance
  - Profile
  - Image prompt assistant
  - Assistant playbook
  - Assistant tweaks
  - AI routing
  - API keys / usage / team access

Marketing tab
- Cover & Visuals
- Box Text
- Barcode
- Company Profile
- Storyboard Studio
```

No database migration is needed.

---

## 1. Add expandable dropdowns to the left sidebar

### File

- `src/components/AppShell.tsx`

### Dashboard dropdown

The **Dashboard** item will become an expandable sidebar group.

It will still link to the dashboard, but clicking/opening the group will show recent games underneath:

```text
Dashboard
  Case Archive
  Recent games
    The Locket Case
    Midnight Archive
    ...
```

Behavior:
- Fetch the user’s projects from the existing `projects` table.
- Show a compact list of recent games under Dashboard.
- Each game links directly to `/projects/$projectId`.
- Highlight the active project when currently inside a game.
- Keep the list short so the sidebar does not become overwhelming, with a “View all games” link back to the dashboard.

### Settings dropdown

The **Settings** item will become an expandable sidebar group with section links underneath:

```text
Settings
  Branding
  Appearance
  Profile
  Image prompt assistant
  Assistant playbook
  Assistant tweaks
  AI routing
  AI connections
  Usage & credits
  AI activity log
  API keys
  Team access
```

Behavior:
- Main Settings link still goes to `/settings`.
- Section links go to anchors like `/settings#branding`.
- The Settings dropdown stays open while on the Settings page.
- Clicking a section scrolls to that section.
- Admin-only Team access will be shown only when the current user is an admin.

---

## 2. Add anchor IDs to Settings sections

### File

- `src/features/settings/SettingsPage.tsx`

Each Settings section will receive a stable ID so the sidebar can jump directly to it:

```text
#branding
#appearance
#profile
#image-prompt-assistant
#assistant-playbook
#assistant-tweaks
#ai-routing
#ai-connections
#usage-credits
#ai-activity-log
#api-keys
#team-access
```

I will keep the current settings cards and content, only making them easier to navigate.

---

## 3. Add an internal Marketing menu

### File

- `src/features/project/MarketingSection.tsx`

Add a polished section menu under the Marketing heading so users can jump between Marketing sections without scrolling through a long page.

### Layout

```text
Marketing
Box, copy & promo

[Cover & Visuals] [Box Text] [Barcode] [Company Profile] [Storyboard Studio]
```

Behavior:
- Each menu item scrolls to the matching section.
- Use sticky/top positioning where appropriate so it stays useful while scrolling, without covering content.
- Highlighting can be simple and clear; the priority is making the sections easy to find.
- Add matching wrapper IDs around each panel:
  - `marketing-cover-visuals`
  - `marketing-box-text`
  - `marketing-barcode`
  - `marketing-company-profile`
  - `marketing-storyboard`

This keeps existing Marketing components intact while making the page easier on the eyes.

---

## 4. Clean up wording and ordering

### Files

- `src/components/AppShell.tsx`
- `src/features/project/MarketingSection.tsx`

Update labels so they match the current app structure:

```text
Box Text
not Box copy

Games
not vague project rows
```

The Marketing tab order will remain:

```text
Cover & Visuals
Box Text
Barcode
Company Profile
Storyboard Studio
```

---

## Technical details

### Files to edit

- `src/components/AppShell.tsx`
  - Add collapsible sidebar groups.
  - Fetch recent projects for the Dashboard dropdown.
  - Add Settings section links.
  - Preserve theme toggle, user profile, and sign out controls.

- `src/features/settings/SettingsPage.tsx`
  - Add IDs to settings sections.
  - Optionally improve top spacing for anchor scrolling.

- `src/features/project/MarketingSection.tsx`
  - Add the internal Marketing menu.
  - Wrap each Marketing panel in an anchor section.

### No backend changes

This is a UI/navigation refactor only. It uses existing project and settings data.
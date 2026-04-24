## Add protection against accidental game deletion + version history

### Goal

Make it safe to delete a game by mistake, and add a way to go back to earlier saved versions of a game by date/time with a preview before restoring.

This is possible, but it is a medium-to-large feature because a game is stored across many tables: overview, suspects, documents, logic flow nodes/edges, envelopes, hints, media, marketing, storyboard, prompts, and chat.

### Recommended approach

Build this in two layers:

```text
1. Trash / soft delete
   If a game is deleted by mistake, it can be restored quickly.

2. Version history / snapshots
   Save dated snapshots of the whole game and allow preview + restore.
```

### User experience

#### 1. Safer delete

Replace the current permanent delete button with:

- A clearer confirmation dialog.
- A “Move to trash” action instead of immediate permanent deletion.
- A “Deleted games” or “Trash” view on the dashboard.
- Restore and permanently delete actions from the trash.

This protects against the most common mistake: accidentally clicking delete.

#### 2. Version history inside each game

Add a **History** button near the current export/delete controls in the game header.

Clicking it opens a panel like:

```text
Version History

Today, 2:14 PM       Manual save       Preview | Restore
Yesterday, 7:02 PM   Auto snapshot     Preview | Restore
Apr 20, 10:30 AM     Before delete     Preview | Restore
```

Each history item should show:

- Date and time.
- Whether it was automatic or manually saved.
- A short label if the user added one.
- Summary counts: suspects, documents, nodes, envelopes, media.

#### 3. Preview before restore

The preview should show a readable summary of that version before restoring:

- Game title, subtitle, phase.
- Cover image if available.
- Counts of major sections.
- Suspect names.
- Document titles.
- Logic flow node titles.
- Marketing/box text summary.

This should not immediately overwrite anything. The user would explicitly click **Restore this version**.

#### 4. Manual snapshots

Add a button:

```text
Save version
```

This lets the user create a named checkpoint, for example:

```text
Before changing ending
Before final box text
Client review version
```

#### 5. Automatic snapshots

Add automatic snapshots at important moments, such as:

- Before moving a game to trash.
- Before restoring an older version.
- Optionally when opening a game after major edits, with throttling so it does not create too many versions.

The first implementation should avoid snapshotting every keystroke. That would create too much data and make the history messy.

### Restore behavior

When restoring a version:

1. Save the current state as a safety snapshot first.
2. Replace the current game data with the selected snapshot.
3. Keep the same game URL/project ID so existing links still work.
4. Show a success message and refresh the game.

### Technical plan

#### Database changes

Add soft delete fields to `projects`:

```text
deleted_at
```

Add a new table for game snapshots:

```text
project_versions
- id
- project_id
- owner_id
- created_by
- created_at
- label
- reason: manual | auto | before_delete | before_restore
- snapshot jsonb
- summary jsonb
```

The snapshot JSON will include the full game state across the related tables:

```text
project
suspects
documents
canvas_nodes
canvas_edges
envelopes
hints
hint_sheets
media_assets
prompts
chat_messages
project_marketing
project_storyboards
project_notifications
```

RLS should ensure users can only access versions for projects they can access. Since this app currently has broad authenticated table policies for many game tables, the snapshot table should at minimum be restricted by the owning user/admin pattern rather than being fully public to all signed-in users.

#### Backend functions

Create backend functions for:

- `create-project-version`
  - Builds a full snapshot for a game.
  - Stores summary metadata for preview lists.

- `restore-project-version`
  - Creates a safety snapshot of the current state.
  - Clears the current related rows for that game.
  - Reinserts rows from the chosen snapshot.
  - Keeps the original `project_id`.

- `trash-project`
  - Creates a `before_delete` snapshot.
  - Sets `deleted_at` instead of deleting the project.

- `restore-trashed-project`
  - Clears `deleted_at`.

#### Frontend changes

- `src/features/project/ProjectWorkspace.tsx`
  - Replace permanent delete with “Move to trash”.
  - Add History button/panel.

- `src/features/dashboard/Dashboard.tsx`
  - Hide trashed games from the main list.
  - Add a “Trash” filter/view.
  - Add restore/permanent delete controls for trashed games.

- New component, likely:
  - `src/features/project/ProjectHistoryPanel.tsx`

- Optional shared helper:
  - `src/lib/project-versions.ts`

#### Export relationship

The current export system already packages a full game. Version history will use a similar data shape internally, but stored in the backend so the user can restore from a date without manually downloading/importing files.

### Scope note

This will create version history for game content going forward. It cannot reconstruct older versions from before the feature existed, except the current game state can be saved as the first snapshot when the feature is added.

### Suggested first milestone

Implement the practical safety version first:

1. Move delete to trash instead of permanent delete.
2. Add manual “Save version”.
3. Add version list with preview.
4. Add restore from version.
5. Auto-create snapshots before trash and before restore.

Later, if needed, we can add more advanced timeline features like automatic daily snapshots, visual diffing, or comparing two versions side-by-side.
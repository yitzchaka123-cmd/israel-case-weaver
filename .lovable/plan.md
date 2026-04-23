

## Finish the Google Drive integration

The DB table `user_google_drive_connections` is in place but nothing else exists — no OAuth flow, no edge functions, no UI, nothing actually uses it. This wires the whole thing up so each teammate connects their own Google account once and gets **export, auto-backup, and import-references** all from that one connection.

### How it works end-to-end

Each user clicks **Connect Google Drive** in Settings → standard Google OAuth consent screen → tokens are stored encrypted in `user_google_drive_connections` (per-user). After that:

- **Export finished case** — one button on the project page that takes the existing `exportProjectPackage` zip and uploads it to a `MyStudio/{Case Title}/` folder in their Drive (instead of downloading a `.zip` to the browser).
- **Auto-backup** — opt-in toggle. When ON, every newly-generated document PDF, envelope mock-up, suspect portrait, cover, marketing image is mirrored to `MyStudio/{Case Title}/auto-backup/{category}/` in the background. No user action.
- **Import references** — a "From Drive" picker next to upload buttons (suspect ref photo, document upload, marketing reference). Pops a folder/file browser, downloads the chosen file into the corresponding Supabase Storage bucket, and continues the existing flow.

Because Google OAuth (not the service-account-style connector) is the only way to get per-user Drive access, we use a custom OAuth flow with a Google Cloud OAuth client — not the `google_drive` Lovable connector (which would only access the developer's own Drive).

### Required from you (one-time setup)

You'll need to create an OAuth client in Google Cloud Console — I'll guide you through it once we start the implementation:

1. Google Cloud Console → APIs & Services → enable **Google Drive API**
2. Create OAuth 2.0 Client (Web application)
3. Add the callback URL I'll give you (`https://disanuvopbwdruathmfx.supabase.co/functions/v1/drive-oauth-callback`)
4. Add scopes: `drive.file` (read/write only files the app creates) + `userinfo.email`
5. Paste **Client ID** and **Client Secret** into two new secrets (`GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`) — I'll prompt for these via `add_secret` once the edge functions are scaffolded

The `drive.file` scope is intentional: the app can only see/touch files **it created** in the user's Drive — it cannot read the rest of their personal Drive. This keeps the consent screen friendly and the trust boundary small.

### Files & changes

**New edge functions** (all use `user_google_drive_connections` + service role for token writes; refresh tokens auto-rotate)

| Function | Purpose |
|---|---|
| `drive-oauth-start` | Returns the Google consent-screen URL with `state=user.id` and required scopes. Frontend redirects to it. |
| `drive-oauth-callback` | Receives `?code` from Google, exchanges for access+refresh tokens, fetches `userinfo` for `google_email`, upserts the row keyed on `user_id`, redirects back to `/settings#drive=connected`. |
| `drive-status` | Returns `{ connected, google_email, scope, auto_backup_enabled }` for the signed-in user. |
| `drive-disconnect` | Revokes the token at Google + deletes the row. |
| `drive-upload` | Inputs: `{ folderPath, fileUrl OR base64Body, mimeType, fileName }`. Refreshes token if expired, ensures every folder in `folderPath` exists (creates missing ones), uploads via Drive multipart upload. Used by both export and auto-backup. |
| `drive-list` | Inputs: `{ folderId?, query?, mimeTypes? }`. Returns files/folders for the picker. |
| `drive-download` | Inputs: `{ fileId, targetBucket, targetPath }`. Streams a Drive file straight into a Supabase Storage bucket and returns the public URL. |

**New shared module**

| File | Purpose |
|---|---|
| `supabase/functions/_shared/google-drive.ts` | `getValidAccessToken(userId)` (uses refresh token if expired), `ensureFolderPath(token, path)` returns folder id, `uploadFile`, `listChildren`, `downloadFileToBucket`. All other functions use these helpers. |

**New schema bits** (single migration)

```sql
alter table public.user_google_drive_connections
  add column auto_backup_enabled boolean not null default false,
  add column root_folder_id text,        -- cached id of "MyStudio" folder
  add column last_error text,            -- surfaces token-refresh failures in UI
  add column last_synced_at timestamptz;

-- Track every backed-up asset so we don't re-upload the same thing
create table public.drive_backup_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  asset_kind text not null,        -- 'document' | 'envelope_cover' | 'suspect' | 'cover' | 'media' | 'case_export'
  asset_id text not null,          -- supabase row id or media url hash
  drive_file_id text not null,
  uploaded_at timestamptz not null default now(),
  unique (user_id, project_id, asset_kind, asset_id)
);
alter table public.drive_backup_log enable row level security;
create policy "Users read own backup log" on public.drive_backup_log
  for select to authenticated using (auth.uid() = user_id);
-- Inserts only via service role (edge functions)
```

**New frontend components**

| File | Change |
|---|---|
| `src/features/settings/GoogleDriveConnection.tsx` | New panel: shows connection state, "Connect Google Drive" / "Disconnect" buttons, the connected Google email, an **Auto-backup new assets** toggle, and a "Test connection" button (uploads a tiny `connection-test.txt`). Wired into `SettingsPage` next to `GeminiConnection`. |
| `src/features/project/DrivePicker.tsx` | New modal: lists folders/files from `drive-list`, supports drilling into folders + filtering by mime type. Returns the selected file id. |
| `src/features/project/ExportMenu.tsx` | Add **"Save case to Google Drive"** menu item next to existing "Download .zip" — calls a new `exportProjectToDrive(projectId)` helper that builds the same zip as today and pipes it through `drive-upload`. |
| `src/lib/export.ts` | Add `exportProjectToDrive(projectId)` (re-uses the existing zip builder, then calls `drive-upload` with `folderPath: "MyStudio/{title}"`). |
| `src/lib/drive-backup.ts` | New helper `backupAsset({ projectId, kind, id, url, fileName })` — fire-and-forget call invoked from the success handlers of `generate-document`, `generate-image`, `generate-envelopes` clients. No-ops if user hasn't enabled auto-backup. |
| `src/features/project/SuspectsSection.tsx`, `DocumentsSection.tsx`, `marketing/CoverAndVisuals.tsx` | Add a small **"From Drive"** button beside each existing **Upload** button. Opens `DrivePicker`, then calls `drive-download` to land the file in the right Supabase bucket. |
| `src/features/settings/SettingsPage.tsx` | Slot the new `<GoogleDriveConnection />` panel into the Settings page. |

### Auto-backup hook points

Background calls to `backupAsset` are added at exactly these success moments:

- `generate-document` succeeds → backup the resulting PDF/image (`asset_kind: 'document'`)
- `generate-image` succeeds for a suspect / envelope / cover / marketing image → backup with the matching `asset_kind`
- `generate-envelopes` bulk-create succeeds → backup any cover image returned

All non-blocking; failures only update `last_error` on the connection row (visible in Settings).

### Folder layout in user's Drive

```text
MyStudio/
└── {Case Title}/
    ├── case-export-{YYYY-MM-DD}.zip      ← created by "Save case to Drive"
    └── auto-backup/                      ← only if auto-backup ON
        ├── documents/
        │   └── 03_The_Letter.pdf
        ├── envelopes/
        │   └── 02_label.png
        ├── suspects/
        │   └── Sarah_Cohen.png
        ├── cover/
        ├── marketing/
        └── media/
```

### Out of scope

- Selective sync rules ("only docs, not images"). Auto-backup is on/off only.
- Two-way sync (changes in Drive flow back to MyStudio). Drive is read for imports, written for exports — but the source of truth stays Supabase.
- Showing a per-asset "Backed up ✓" badge in the UI. The `drive_backup_log` is queryable for a follow-up if you want it.
- Sharing/permission controls on the created Drive folder — files inherit the user's default Drive privacy.


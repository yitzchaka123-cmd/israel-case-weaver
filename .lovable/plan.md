

## Per-user Google Drive export with native folder picker

Each signed-in user connects **their own** Google Drive (separate from the Google sign-in), and on every export they pick a destination folder using **Google's native Picker UI**. Exports land in their account, never mine.

### One-time setup you'll need to do

This is the one piece I can't do for you — Google requires the OAuth credentials live in *your* Google Cloud project:

1. **Google Cloud Console → APIs & Services**
   - Enable **Google Drive API** and **Google Picker API**.
   - OAuth consent screen: External, add scopes `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file` (only files the app creates — minimal, easy to verify), and authorize your app domains (`*.lovable.app` + any custom domain).
   - Create an **OAuth 2.0 Client ID (Web application)** with redirect URI `https://{your-domain}/api/auth/google-drive/callback`.
   - Create an **API Key** (restricted to Picker API + your domain) — required by the Picker.
2. Paste the three values into Lovable when prompted: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_API_KEY` (Picker key — public, also exposed as `VITE_GOOGLE_PICKER_API_KEY`).

The `drive.file` scope is the safest: the app can only see/write files **it created**, never the user's other files. Google approves it without a security review.

### The user flow

1. **Settings → Integrations → Google Drive** card. Shows "Not connected" with a **Connect Google Drive** button.
2. Clicking it opens Google's consent screen in a popup. They approve, the popup closes, the card now shows their Drive email + a **Disconnect** button.
3. Back in the project, **Export → Google Drive…** opens the same dialog as before (image format: PDF / original / both; section checkboxes; folder name).
4. On confirm, **Google's native folder picker** opens — they browse their own Drive, pick (or create) a destination folder, hit **Select**.
5. Upload runs with a progress bar (`Uploading 12 / 47…`); on success a toast with **Open in Drive** linking straight to the new project folder inside their chosen parent.
6. Token expires? Next export silently refreshes using the stored refresh token. If refresh fails, the dialog shows **Reconnect Google Drive** and walks them back through consent.
7. **ZIP download stays exactly as today** — no Drive connection needed.

### What gets built

**Database (one new table)**
```text
user_google_drive_connections
  user_id uuid PK references auth.users
  google_email text
  access_token text   ← encrypted at rest
  refresh_token text  ← encrypted at rest
  token_expires_at timestamptz
  scope text
  connected_at, updated_at
RLS: user can only select/delete their own row; only the edge functions
(via service role) write tokens.
```

**Edge functions (3 new)**
| Function | Job |
|---|---|
| `google-drive-oauth-start` | Builds Google's auth URL with PKCE state, returns it to the client to open in a popup. |
| `google-drive-oauth-callback` | Receives Google's redirect, exchanges code → tokens, stores them in the new table, closes the popup with `postMessage` to the opener. |
| `google-drive-export` | Reads the user's tokens, refreshes if expired, fetches project rows, uploads files (sequential, multipart) into the folder ID the picker returned, returns root folder URL + per-file success summary. |

PDFs are still rendered **client-side** with `jspdf` (matches the existing "Save as PDF" output), then posted as base64 to `google-drive-export` along with URL-referenced media (which the function streams server-side).

**Client work**
| File | Change |
|---|---|
| `src/features/settings/SettingsPage.tsx` | New **Google Drive** card: connect / disconnect, shows linked email, "Reconnect" if scope missing. |
| `src/features/settings/GoogleDriveConnection.tsx` *(new)* | The card component + popup OAuth flow + `postMessage` listener. |
| `src/lib/google-picker.ts` *(new)* | Loads `gapi` + `google.picker` from CDN once, exposes `pickFolder(accessToken): Promise<{folderId, folderName}>`. |
| `src/features/project/ExportToDriveDialog.tsx` *(new)* | Connection check → options form → "Pick destination folder" button (opens Picker) → upload progress → success toast. |
| `src/features/project/ExportMenu.tsx` | Add "Google Drive…" menu item that opens the dialog. |
| `src/lib/export.ts` | Add `downloadUrl(url, filename)` helper; add `buildProjectTree(projectId, options)` shared by ZIP + Drive paths; add `exportProjectToDrive(projectId, options, folderId)` that builds blobs and POSTs them. |
| `src/features/project/MediaSection.tsx`, `SuspectsSection.tsx`, `DocumentsSection.tsx`, `ProjectOverview.tsx` | Per-asset **Download** icon buttons (universal download buttons from the previous plan, unchanged). |

### Security notes

- **PKCE on the OAuth start** so the code-exchange can't be hijacked.
- Tokens stored in a dedicated table with **RLS = owner-only read, no client write** — only edge functions write via service role.
- `drive.file` scope means the app physically *cannot* read any file it didn't create, even if tokens leaked.
- Picker runs entirely in the user's browser with their own access token; the folder ID returned to us is the only thing that crosses the wire.
- Edge function verifies `auth.uid()` matches the row owner before reading tokens.

### What stays the same

- Existing ZIP exports (Full / Documents / Media / Prompts) — unchanged.
- Google sign-in flow — unchanged. The Drive connection is purely additive.
- All assistant playbook, generation, canvas, and chat behavior — untouched.

### Order of operations

1. I scaffold the DB table, the 3 edge functions, the Settings card, the Picker helper, the new dialog, and the universal download buttons.
2. I'll prompt you for `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` / `GOOGLE_DRIVE_API_KEY` (Picker) once the code is in place — with a step-by-step Google Cloud Console walkthrough.
3. You connect your own Drive once to smoke-test, then it's live for every other user too.

### Out of scope (good follow-ups)

- A "default destination folder" remembered per user so the picker pre-selects it.
- Resumable uploads for very large videos.
- A "sync existing folder" mode (today every export creates a fresh folder).
- Broader `drive` scope to let users export *into* arbitrary existing folders they didn't create with the app (would require Google security review).


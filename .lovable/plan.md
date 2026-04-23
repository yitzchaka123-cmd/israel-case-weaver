

## Remove Google Drive integration; keep zip export

Drive is wired into Settings, the Export menu, and the Suspects "From Drive" / auto-backup hooks. Export already supports a local zip download — that path stays and becomes the only export option.

### Frontend changes

- **`src/features/project/ExportMenu.tsx`** — remove the "Save case to Google Drive" item, the `Cloud` icon import, and the `exportProjectToDrive` import.
- **`src/lib/export.ts`** — delete `exportProjectToDrive`. Keep `exportProjectPackage` (the zip), `exportDocumentsOnly`, `exportPromptsOnly`, `exportMediaOnly`, and the shared `buildProjectPackage` helper.
- **`src/features/project/SuspectsSection.tsx`** — remove:
  - `DrivePicker` import + usage
  - `backupAsset` import + the fire-and-forget call after portrait generation
  - `HardDrive` icon, "From Drive" button, `drivePickerOpen` state
- **`src/features/settings/SettingsPage.tsx`** — remove the `GoogleDriveConnection` import and its entire "Google Drive" `Section` block.
- **Delete files**:
  - `src/features/settings/GoogleDriveConnection.tsx`
  - `src/features/project/DrivePicker.tsx`
  - `src/lib/drive-backup.ts`

### Backend changes

- **Delete edge functions** (code + deployment):
  - `drive-oauth-start`
  - `drive-oauth-callback`
  - `drive-status`
  - `drive-list`
  - `drive-upload`
  - `drive-download`
  - `drive-disconnect`
  - `drive-toggle-backup`
- **Delete shared helper**: `supabase/functions/_shared/google-drive.ts`.

### Database

- Migration to drop the now-unused tables:
  - `drop table if exists public.drive_backup_log;`
  - `drop table if exists public.user_google_drive_connections;`

### Out of scope / unchanged

- Local zip download (`Download .zip`), Documents-only, Media-only, Prompts JSON exports — all kept as-is.
- No changes to authentication, storage buckets, or other edge functions.
- The `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` secrets in Lovable Cloud become unused; you can clear them later from Cloud settings if you want — not required for the code to work.

### Validation

- Settings page renders without the Google Drive section.
- Export menu shows only: Download .zip, Documents only, Media only, Prompts (JSON).
- Opening a suspect shows Generate / Upload only (no "From Drive" button) and generating a portrait no longer triggers a backup call.
- No console errors referencing `drive-*` functions or missing imports.


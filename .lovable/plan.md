

## Add Google Drive export + universal download buttons

### What we'll build

1. **"Export to Google Drive" option** in the existing `ExportMenu` — same dropdown that currently has "Full project package / Documents only / Media only / Prompts (JSON)". The existing ZIP options stay exactly as-is.
2. **A pre-export dialog** that lets you choose what to include and how images are saved.
3. **Per-asset download buttons** on every media card and document so you can grab one file at a time without exporting the whole project.

### The Google Drive flow

When you click **Export → Google Drive**, a small dialog opens:

- **Image format** — radio: *PDF only* / *Original image only* / *Both* (default: Both).
- **Include sections** — checkboxes (all on by default): Documents, Media, Suspects, Prompts, Project JSON, README.
- **Destination** — read-only line showing the connected Google account; a "Change account" link opens the connector reconnect flow.
- **Folder name** — pre-filled with the project title; editable.

On confirm the project is uploaded to Drive in this tree (mirrors today's ZIP structure):

```text
{Folder name}/
├── README.md
├── project.json
├── prompts.json
├── documents/
│   ├── 101_Top_Secret_Memo.txt          ← hebrew_content
│   ├── 101_Top_Secret_Memo.png          ← original (if "Original" or "Both")
│   ├── 101_Top_Secret_Memo.pdf          ← rendered to print_size (if "PDF" or "Both")
│   └── …
├── media/
│   ├── cover/
│   │   ├── Final_Cover_a1b2c3.prompt.txt
│   │   ├── Final_Cover_a1b2c3.png       ← if "Original" or "Both"
│   │   └── Final_Cover_a1b2c3.pdf       ← if "PDF" or "Both"
│   ├── back/   …
│   ├── news/   …
│   ├── promo/  …  (videos: original only — PDF doesn't apply, hidden from option)
│   └── external/ …
└── suspects/
    ├── Yael_Cohen.json
    └── Yael_Cohen.png
```

PDFs use the same `jspdf` page-size logic that `DocumentsSection` already uses for "Save as PDF" (A3/A4/A5/A6/Business card → fitted with letterboxing). Media images without a print size default to A4 portrait.

### How the upload works

A new `export-to-drive` edge function takes `{ projectId, options }`, fetches everything (same queries as `src/lib/export.ts`), builds the file tree in memory, and uploads each file via the **Google Drive connector gateway** (`google_drive`, gateway-enabled). Folder hierarchy is created with `mimeType: application/vnd.google-apps.folder`, files via the multipart upload endpoint. The function returns the root folder's `webViewLink`; the UI shows a toast with an "Open in Drive" button.

PDF rendering happens **client-side** before upload (same as today's "Save as PDF"): the browser builds the PDFs, then posts the assembled blob list to the edge function, which streams them to Drive. This avoids needing `jspdf` in the Worker runtime and keeps the function simple.

If Google Drive isn't connected yet, the dialog shows a single **"Connect Google Drive"** button that triggers the standard connector linking flow; once linked, the dialog re-renders with the upload form.

### Per-asset download buttons

Today only documents have a "Save as PDF" affordance and media cards only have an "Open" external link. We add a small **Download** icon button on:

- **Every media card** (`AssetCard` in `MediaSection.tsx`) — downloads the original file (image/video/whatever) using its public URL with a clean filename `{category}_{title}.{ext}`. For prompt-only assets, downloads the prompt as `.txt`.
- **Asset dialog** (`AssetDialog` in `MediaSection.tsx`) — same Download button next to "Open", plus a "Save as PDF" button when the asset is an image.
- **Suspect cards** (`SuspectsSection`) — Download avatar PNG.
- **Document dialog** — already has "Save as PDF"; add a sibling "Download original" button for the underlying generated/uploaded image file.
- **Cover image** in `ProjectOverview` — small Download button next to the existing controls.

All downloads use a tiny shared helper `downloadUrl(url, filename)` (fetch → blob → `saveAs`) added to `src/lib/export.ts`, reusing `file-saver` which is already a dependency.

### Files touched

| File | Change |
|---|---|
| `src/lib/export.ts` | Add `downloadUrl(url, filename)` helper; add `buildProjectTree(projectId, options)` that returns the in-memory file list (used by both the new Drive export and reused by the existing zip exports for consistency); add `exportProjectToDrive(projectId, options)` that builds blobs (including PDFs via `jspdf`) and POSTs them to the new edge function. |
| `src/features/project/ExportMenu.tsx` | Add "Google Drive…" item that opens the new dialog. Existing items unchanged. |
| `src/features/project/ExportToDriveDialog.tsx` *(new)* | The dialog described above. Handles connection check, options, progress, and the "Open in Drive" success toast. |
| `src/features/project/MediaSection.tsx` | Add Download icon button on `AssetCard` and inside `AssetDialog`. |
| `src/features/project/SuspectsSection.tsx` | Add Download button on suspect cards. |
| `src/features/project/DocumentsSection.tsx` | Add "Download original" button next to existing "Save as PDF". |
| `src/features/project/ProjectOverview.tsx` | Add Download button on the cover image. |
| `supabase/functions/export-to-drive/index.ts` *(new)* | Verifies user owns the project, accepts the assembled file list (`{ path, mime, base64 | url }[]`), creates folders in Drive via the connector gateway, uploads files, returns the root folder URL. Files referenced by URL are fetched server-side; PDFs are sent as base64 from the client. |
| `supabase/config.toml` | Add `[functions.export-to-drive]` block with `verify_jwt = true` (default behaviour, just being explicit since this function reads user identity). |

### Connector setup

This requires the **Google Drive** connector (gateway-enabled). On first use the dialog calls the standard connector connect flow with `connector_id: google_drive`. Once linked, both `LOVABLE_API_KEY` and `GOOGLE_DRIVE_API_KEY` are auto-injected into the edge function — no manual secret entry needed.

**Important caveat about per-user vs developer Drive**: the connector authenticates *the developer's Google account* (whoever links it). For a single-user app like this one, that's exactly what you want — exports always land in your Drive. If you later want each end-user to export to *their own* Drive, that requires per-user OAuth (separate plan, much bigger lift).

### Technical notes

- **No DB migration.** No new tables; everything reads from existing rows.
- **PDFs match the existing "Save as PDF" output** so the Drive copy and the manual download are byte-identical.
- **Videos**: the "PDF" option is grayed out and skipped for video assets (cover/back/news/external get PDFs; promo videos are originals only).
- **Concurrency**: the edge function uploads files sequentially to stay under Drive's per-second quota; for a typical 30-asset project this is < 20 seconds. A progress bar in the dialog reports "Uploading 12 / 47…" via streaming response.
- **Failure handling**: if a single file upload fails, the function continues, returns a partial-success summary, and the toast lists which files were skipped with the Drive folder link still working.
- **ZIP path unchanged**: today's "Full project package" / "Documents only" / "Media only" / "Prompts (JSON)" all still produce the same zips. The new Drive export uses the same builder under the hood, so structure stays in sync.
- **Universal download buttons** are pure client code — fetch the public URL, save via `file-saver`. No edge function needed.

### What stays the same

- Existing ZIP export functions and menu items.
- All assistant playbook, chat, generation, and canvas behavior.
- Storage buckets, RLS policies, schema.

### Out of scope for v1 (good follow-ups)

- Per-end-user Drive OAuth (currently exports always go to the connected developer account).
- Resumable uploads for very large videos.
- A "sync" mode that updates an existing Drive folder instead of creating a fresh copy each time.


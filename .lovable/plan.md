## Why "Draft all" said "no scope"

The Documents tab's **Draft all** button calls the bulk function with the default `skipExisting: true`. The bulk function then filters out every document that already has Hebrew text:

```ts
if (mode === "draft") return !(d.hebrew_content && d.hebrew_content.trim().length > 0);
```

Your case already has drafts on every doc (status "review"), so 0 docs matched and you got the "No documents matched the scope." toast. The confirm dialog promised "Existing drafts will be regenerated," but the code did the opposite — that's the bug.

## Fix

Replace the simple `confirm()` in `startDraftAll` with a small choice dialog so each click of **Draft all** lets you pick:

- **Overwrite all drafts** — re-draft every document in this case (sends `skipExisting: false`).
- **Only missing drafts** — draft only docs that have no Hebrew content yet (sends `skipExisting: true`, current behavior).

Plus a small UX cleanup so empty results aren't confusing.

### Changes

1. **`src/features/project/DocumentsSection.tsx`**
   - Add a small AlertDialog (or shadcn Dialog) state for "Draft all" with two action buttons: *Overwrite all* and *Only missing*. Cancel closes it.
   - `startDraftAll` opens the dialog instead of calling `confirm()` directly.
   - Each action calls `launchBulk({ mode: "draft", scope: "all_remaining", concurrency: 2, skipExisting: <bool>, logChat: ... })` with a `logChat` line that reflects the chosen mode.
   - In `launchBulk`, when the response is the empty-scope case (`!json.jobId`), upgrade the toast copy depending on mode: for draft + skipExisting it should say "All documents already have drafts — pick 'Overwrite all' to redo them." instead of the generic "No matching documents."

2. **`src/features/project/DocumentsSection.tsx` → `launchBulk` signature**
   - Accept `skipExisting?: boolean` in `overrides` and forward it in the request body to `bulk-generate-documents`.

3. **No edge function changes needed.** `bulk-generate-documents` already honors `skipExisting` from the request body (line 269). We just need to send `false` from the client when the user picks "Overwrite all."

### Out of scope

- Not changing the bulk function defaults — other callers (image / document modes) still benefit from `skipExisting: true`.
- Not touching the `Generate all` flow.

After approval I'll implement these edits and you can re-run **Draft all** on this case.

Here’s what’s left from the original plan, based on what is already built.

Completed already:

- Playbook contains the new principles: direct file-first, strict model ownership, Claude Skills, output type choices, and asset metadata.
- Assistant full-auto now creates a placeholder assistant message first, so `created_by_message_id` references are safer.
- Document generation has a `document` mode that asks the selected model to create the actual file directly.
- Claude document generation uses Messages API, code execution, Skills beta, Files API beta, `container.skills`, file ID detection, file download, storage save, and document/media metadata.
- Non-Claude document generation is strict enough to avoid hidden Gemini fallback by passing `disableFallback: true`.
- Settings has a Claude Skills manager with built-in/custom sections, upload, enabled toggle, usage surfaces, SKILL.md metadata, install status, archive inspection, and validation messages.
- Claude Skills are passed into chat, documents, marketing, logic analysis, and storyboard/media prompts.
- Documents tab has Image / Document file / Both controls.
- Media library shows document assets, failed attempts, model/provider/skill badges, and has a PDF/image lightbox toggle when a preview exists.

Remaining plan to finish

&nbsp;

2. Tighten full-auto document failure handling

- Confirm every assistant-created row that uses `created_by_message_id` only uses the placeholder message ID after the placeholder insert succeeds.
- If the placeholder insert fails, return a recoverable assistant error instead of continuing with broken references.
- Make full-auto document 0 retry cleanly after a generation failure.
- Ensure `generate_document_assets` receipts clearly say which step failed: body text, direct file, image, or both.

3. Harden strict model ownership everywhere document/file generation can happen

- Keep `disableFallback: true` for document/file mode.
- Audit assistant full-auto, manual documents, and “both” mode so no silent provider switching remains.
- Make failed receipts explicit, for example:
  - “Claude could not produce a downloadable PDF.”
  - “GPT responded but did not return a downloadable DOCX.”
  - “Gemini direct key unavailable for strict file generation.”
- Keep generic planning/image fallbacks separate from strict document/file behavior.

4. Improve generated file metadata as first-class assets

- Continue using `media_assets` as the generated asset ledger, because it already has most required fields.
- Fill missing metadata consistently for document images too, not only document files:
  - `asset_type`
  - `document_format`
  - `provider`
  - `model`
  - `effective_model`
  - `generation_mode`
  - `status`
  - `error_message`
  - `source_document_id`
  - `created_by_message_id` where available
- Decide whether a small schema migration is needed for any missing field, but avoid a new `generated_assets` table unless `media_assets` proves insufficient.

5. Add better preview support for real files

- For PDFs: store `document_preview_url` / `preview_url` when a preview image exists.
- For generated document files without a preview, show a polished file card with download/open actions.
- Keep DOCX/PPTX/XLSX as file cards first; richer previews can come later.
- Improve the lightbox to show file type, provider/model, skill badge, and download button, not just preview/open.

6. Expand output type controls beyond the Documents tab 

Add Image / Document-file / Both controls where relevant:

- Cover page / cover asset generation.
- Marketing poster and box/back-panel flows.
- Media generation tab.
- Assistant full-auto defaults.

Suggested defaults:

- Evidence document: Document/file or Both.
- Visual prop: Image.
- Marketing poster / cover / back panel: Both where useful.
- Logo: Image.
  &nbsp;

9. Final verification pass

- Run the build.
- Deploy changed backend functions.
- Spot-check:
  - Settings loads Claude Skills.
  - Built-in skills can be enabled/disabled per surface.
  - Invalid uploads show useful failure messages.
  - Manual document file generation records success/failure as a media asset.
  - Full-auto does not get stuck on document 0.
  - Media library shows file/image assets and failed attempts.

&nbsp;
Plan: finish the direct document generation + growing Claude Skills system

Some of the earlier plan is already in place: the assistant message placeholder prevents broken `created_by_message_id` links, document file generation uses strict no-fallback routing, Claude built-in Skills are passed for document creation, generated file prompts are saved to prompts/log metadata, the Media Library shows prompts, and the PDF/image lightbox toggle exists.

The remaining work is to close the gaps so the whole plan is actually complete.

1. Complete generated asset metadata
- Extend generated file/media rows to store the full receipt fields requested in the plan:
  - `skill_source`, `skill_name`, `status`, `error_message`, `created_by_message_id` where missing.
- Make failed document-file attempts visible as first-class failed media assets, not only toast/log entries.
- Keep prompt saving in all three places: `prompts`, `ai_run_logs.prompt_excerpt`, and `media_assets.prompt`.

2. Improve direct document generation for all selected models
- Keep Claude as the rich path with Skills + file download.
- Keep OpenAI/Gemini strict: ask the selected model to create the file directly; if no downloadable file is returned, show and save a clear failed attempt.
- Make failure wording consistent in backend, assistant receipts, Documents UI, Media Library, and run logs.
- Ensure “Both” mode creates text + document file + image, and reports partial failures clearly.

3. Make Claude Skills a broader runtime system
- Add a shared Claude Skills loader/helper that can fetch enabled skills by usage surface.
- Pass enabled Claude skills into Claude assistant-chat calls, not only `generate-document`, so Claude can choose among installed skills for chat/document/marketing/media/analysis style tasks.
- Add tool/playbook guidance so the assistant can recognize “install/use/enable a Claude skill” requests and explain what is needed when no skill package is attached.

4. Upgrade Claude Skills Settings
- Split built-in Claude Skills from custom installed Skills.
- Show description, source, skill ID, version, enabled status, installed/source info, and usage surfaces.
- Add the missing usage surfaces from the plan: assistant chat, documents, marketing, logic analysis, media planning.
- Keep admin-only mutation controls.

5. Add real custom skill installation backend path
- Add a backend function for installing/upload-registering custom Claude Skill packages as far as the Anthropic API allows.
- Settings upload should call that backend path instead of only storing the uploaded file URL.
- Save returned skill ID/version/metadata into `claude_skills`.
- If the API does not accept a package or returns a limitation, save a clear failed install state/message and show it in Settings.

6. Add output type controls beyond Documents
- Documents already has separate image/file buttons; add a clearer “Output type: Image / Document-file / Both” control.
- Extend the same output-type choice to assistant full-auto generation.
- Add output-type controls to relevant marketing/cover/back-panel/media generation surfaces where assets are created.
- Context defaults:
  - evidence documents: document/file or ask,
  - visual props/logo: image,
  - marketing poster/cover/back panel: image/PDF/both options.

7. Improve PDF/document preview cards and viewer behavior
- Make Media Library document cards show file type, provider/model, skill badge, status, error if failed, and prompt copy.
- Use preview image when available, with PDF/document view toggle in the lightbox.
- For DOCX/PPTX/XLSX, show file cards with open/download and metadata; PDF gets embedded viewer when possible.
- Add the same prompt/receipt section in the Documents dialog for generated file prompts.

8. Expand playbook rules and previews
- Add explicit playbook text for:
  - selected model owns direct document generation,
  - no silent fallback,
  - save PDF/document prompts,
  - Claude Skills are growing installed capabilities,
  - output type should be asked or chosen according to defaults,
  - assistant should suggest skill installation when a missing skill would help.
- Surface these settings in Assistant Rules so they can be reviewed and edited.

Technical details
- Database migration likely needed for `media_assets`: `skill_source`, `skill_name`, `status`, `error_message`, `created_by_message_id`; and for `claude_skills`: `description`, `metadata`, `installed_by`, `installed_at`, possibly install status/error fields.
- Backend files likely touched: `generate-document`, `assistant-chat`, shared AI/Claude helper files, and possibly marketing/media generation functions.
- Frontend files likely touched: `ClaudeSkillsPanel`, `AssistantPlaybookPanel`, `DocumentsSection`, `MediaLibrarySection`, `AssetLightbox`, assistant receipt rendering, marketing/cover/media generation panels.
- I will not manually edit generated backend type files; they update automatically.
- I will verify with a production build after implementation.
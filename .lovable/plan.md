

## Three additions: AI run log, image badges, and persistent prompt visibility

### 1. New `ai_run_logs` table + Settings page

A new table records every AI call so you have a single place to see what actually ran:

| Column | What it stores |
|---|---|
| `id`, `created_at`, `user_id`, `project_id` | Standard |
| `surface` | Where it was called from (`assistant-chat`, `generate-image`, `suggest-image-prompt`, `generate-marketing-copy`, `generate-storyboard`, `generate-document`, `generate-logic-flow`, `generate-envelopes`, `explain-canvas-node`) |
| `requested_model` | What you picked (e.g. `claude-opus-4.5`) |
| `effective_model` | What actually ran (e.g. `openai/gpt-5.2`) |
| `fallback` | `none` \| `openai-direct` \| `lovable-ai` |
| `status` | `ok` \| `error` |
| `latency_ms`, `error_message` | For debugging |
| `target_id`, `prompt_excerpt` | Lets you trace the row back to a specific image / message |

RLS: each user reads their own rows; admins read all.

**Settings → "AI activity log"** section (new): paginated table, last 200 runs by default, filter chips for surface and fallback. Color-coded row dot (green = no fallback, amber = fallback fired, red = error). Inline "View prompt" expand for image runs.

### 2. Image generation badges

Update `generate-image` to return `requestedModel`, `effectiveModel`, `provider`, and `fallback` in the JSON response, plus persist `effective_model` and `fallback` onto `media_assets` (two new columns: `effective_model text`, `fallback text`). Existing `model` column stays as the requested one for back-compat.

Then surface a **provider badge** in three spots:

- **AssetCard grid** (`MediaSection`, `CoverAndVisuals`): small chip top-right of every image thumbnail — green "Nano Banana Pro" if no fallback, amber "Nano Banana Pro → ChatGPT (fallback)" if it fell back. Hover shows the full requested → effective tooltip.
- **AssetDialog** (existing image detail modal): expands the chip into a full line: *"Generated with `gpt-image-2` (your OpenAI key) · requested `nano-banana-pro` · fell back due to Gemini 429."*
- **Project cover, suspect thumbnails, envelope covers**: same hover chip overlaid on the image (top-right corner, only visible on hover).

For the Storyboard keyframes and marketing back-cover, same hover chip on the rendered image.

### 3. Stop losing prompts

This is the source of "the prompt got deleted":
- `generate-image` already inserts a `prompts` row, but only `media`-target images also keep the prompt on `media_assets.prompt`. Suspect, cover, envelope, storyboard, marketing-back currently overwrite or never store the prompt anywhere visible.
- The `AssetDialog` clears local edit state on close — if the regenerate fails, the edited prompt is gone.

Fixes:
- Always write the final prompt into the corresponding row's prompt field — add `prompt`/`prompt_history jsonb` columns to `suspects`, `envelopes`, `projects` (cover_prompt), and one to `project_storyboards` shots so every generated image carries its origin prompt.
- `prompt_history` is appended on every regenerate (timestamp + prompt + effective_model + fallback). Used by the hover badge and the new log to show "what generated this image" with full lineage.
- Auto-save the edited prompt in `AssetDialog` on every change (debounced) so closing the modal never wipes work in progress.
- Show prompt history under each image in the dialog as a collapsible "Previous prompts" list.

### Behavior summary

| Surface | Before | After |
|---|---|---|
| Image grid (Media, Marketing) | No badge | Hover chip with requested → effective model |
| Image dialog | "Originally generated with: model" | Full provenance line + fallback reason + prompt history |
| Cover / suspect / envelope / storyboard images | Prompt sometimes lost | Prompt + history persisted on the row itself |
| Settings | No log | New "AI activity log" with filter, status dots, expand |
| `media_assets.prompt` | Set on insert, cleared on retry | Always reflects the prompt that produced the current `url`; history in `prompt_history` |

### Technical changes

**Migration**
- Create table `ai_run_logs` with RLS (`user_id = auth.uid()` for select; admins read all; service role inserts).
- Add columns: `media_assets.effective_model text`, `media_assets.fallback text`, `media_assets.prompt_history jsonb default '[]'`.
- Add columns: `suspects.thumbnail_prompt text`, `suspects.thumbnail_prompt_history jsonb default '[]'` (and same `_alt_` pair).
- Add columns: `projects.cover_prompt text`, `projects.cover_prompt_history jsonb default '[]'`.
- Add columns: `envelopes.cover_prompt text`, `envelopes.cover_prompt_history jsonb default '[]'`.
- Add columns: `project_storyboards.shot_prompts jsonb default '{}'` (keyed by shot id → prompt + history).

**Edge functions** — add a tiny shared `logAiRun()` helper in `_shared/ai-router.ts` and call it after every `chatCompletions(...)` and `generateImage(...)`. Same helper extracts `x-ai-fallback` / computes `effectiveModel`. Update each of the 8 functions listed above (one call site each).

**`generate-image`** specifically:
- Extend the response with `{ requestedModel, effectiveModel, provider, fallback }`.
- For each `target` (`media`, `suspect-thumbnail`, `suspect-alt-thumbnail`, `project-cover`, `envelope`), persist the prompt + history + effective_model + fallback onto the right row.

**Frontend**
- New `src/features/settings/AiRunLog.tsx`, mounted as a Section in `SettingsPage.tsx`.
- New `src/components/AiOriginBadge.tsx` — reusable hover chip (`requested`, `effective`, `fallback`). Used by `MediaSection.AssetCard`, `MediaSection.AssetDialog`, `CoverAndVisuals` (cover + extras), `SuspectsSection` (thumbnails), `EnvelopesSection` (envelope covers), `StoryboardStudio` (keyframes), `BarcodeAndBackPanel` (back image), `ProjectOverview` (cover).
- Update each generation handler to read the new response fields and update local cache so the badge appears immediately without a refetch.
- `AssetDialog`: debounced autosave of `editPrompt` to `media_assets.prompt`; render `prompt_history` as collapsible list.

### Out of scope

- No retry-from-log button (tell me if you want one — easy to add).
- No CSV export of the log (also easy follow-up).
- No image-gen badge on the assistant chat avatar — assistant chat is text-only; badge there is for the next round when we tackle text-model badges.


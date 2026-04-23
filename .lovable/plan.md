

## Three fixes for the AI provider settings

### 1. "Image generation" picker → real model dropdown

Today the **AI provider routing** section shows Planning and Documents as full dropdowns (Lovable, Gemini variants, OpenAI variants, Claude variants), but **Image generation** is just a 2-button toggle (`Lovable` / `OpenAI`). Replace it with a real grouped dropdown matching the per-surface `ImageModelPicker`:

- **Lovable AI Gateway** (workspace credits): Nano Banana, Nano Banana 2, Nano Banana Pro
- **Your Google key (direct)**: same three Nano Banana models routed via your `GEMINI_API_KEY`
- **OpenAI**: ChatGPT Image 1 (gpt-image-1), ChatGPT Image 2 (gpt-image-2)

This sets the **workspace default** that's used when a per-surface picker has no override. The existing per-image `ImageModelPicker` (cover, suspect, media…) keeps overriding.

### 2. Add a "Prompt generation" row

Add a fourth row in **AI provider routing** called **Prompt generation** (drives `suggest-image-prompt`), using the same `TEXT_PROVIDER_OPTIONS` dropdown as Planning/Documents (Lovable, all Gemini direct/gateway, OpenAI 5/5.2/5.4/mini, Claude Sonnet/Opus/Haiku).

- New profile column: `ai_provider_prompt_writer text default 'lovable'`
- `suggest-image-prompt` already accepts a `writerModel` override per call — we extend its model resolution to fall back to `profile.ai_provider_prompt_writer` (instead of `profile.ai_provider_planning`) when no per-surface override is set
- The per-surface `PromptWriterModelPicker`'s "Use project default" entry now reads the new column

### 3. Fix the misleading Claude test ("404 claude-3-5-haiku-latest")

That 404 doesn't mean Claude is broken — it means the **test ping** in `api-key-manager` is calling a stale model id (`claude-3-5-haiku-latest`) directly against Anthropic. Your assistant calls actually route through the **Lovable AI Gateway** as `anthropic/claude-haiku-4-5`, which is a totally different code path. So the assistant works, the test fails, and you're left confused.

Two changes:

a. **Update the Anthropic test ping** in `supabase/functions/api-key-manager/index.ts` to use `claude-haiku-4-5` (the current id). If that 404s too, fall back to listing models via `GET /v1/models` (cheaper + version-stable) and report which models the key can see.

b. **Add a clarifying note** under the Claude key row in `ApiKeyManager.tsx`: *"This tests your Anthropic key directly. The assistant normally calls Claude via the Lovable AI Gateway, which uses workspace credits — not this key. The direct key is only used if you pick a `claude` model and the gateway is down."* (Matches how Gemini-direct is already labeled.)

### Separately: the assistant's "error creating 21 nodes" you saw

That's not a Claude problem — that's the canvas tool-call path failing partway through (a known issue with multi-step tool runs, separate from model selection). I'll leave that out of scope here unless you want me to dig into it next; want me to look at the assistant tool-call error after these settings fixes land?

### Files touched

- `src/features/settings/SettingsPage.tsx` — replace `ProviderRow` for Images with a `ProviderSelectRow` using new `IMAGE_PROVIDER_OPTIONS`; add a new `Prompt generation` row; persist `ai_provider_prompt_writer`
- `src/features/settings/ApiKeyManager.tsx` — add clarifying note under the Anthropic row
- `supabase/functions/api-key-manager/index.ts` — switch Anthropic ping model to `claude-haiku-4-5`, add `GET /v1/models` fallback
- `supabase/functions/suggest-image-prompt/index.ts` — read `profile.ai_provider_prompt_writer` first, fall back to `ai_provider_planning`, then `lovable`
- **Migration**: `ALTER TABLE profiles ADD COLUMN ai_provider_prompt_writer text NOT NULL DEFAULT 'lovable'`; matching column also added to `ai_provider_images` value validation if needed (it's already free-form text — no constraint change)

### Out of scope

- The "21 nodes failed" assistant error — separate tool-call investigation
- Adding image-model routing (Lovable vs Direct vs OpenAI) inside `generate-image` — it already auto-routes based on the model id picked; this change is purely about the **default** picker UI


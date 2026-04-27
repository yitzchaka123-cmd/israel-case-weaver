
# Prompt Studio — Master Control Over How the System Thinks

## Goals

1. **One Master Prompt** that is automatically prepended/injected into **every AI call** in the platform (chat, image prompts, documents, marketing, storyboards, envelopes, canvas, hints, suspects, inline images, etc.).
2. **Per-surface system prompts** — every individual edge function's system prompt becomes editable from the UI, with the hardcoded version shipped as the default fallback.
3. **Versioning + revert** — every save creates a new version; one click rolls back.
4. **Live test panel** — paste a sample user message, see exactly what the assembled prompt looks like and what the model returns, before you save.
5. **Visibility** — for any AI run, show which Master Prompt version + which surface override version was used (origin badge already exists; we extend it).

## How it changes "Why didn't my playbook edit work?"

Today the playbook is only read by ~3 surfaces. After this plan:
- The Master Prompt is read by **all ~12 surfaces** (chat, suggest-image-prompt, generate-document, generate-marketing-copy, generate-storyboard, generate-envelopes, arrange-canvas, explain-canvas-node, generate-logic-flow, assistant-tweaks-edit, generate-document-inline-image's prompt assistant, etc.).
- Each surface still has its own editable system prompt that you can tune independently.
- The playbook stays as a separate, more structured tool (envelopes already use it). It is not removed.

## What you will see in the app

A new **Settings → Prompt Studio** tab with three sections:

### 1. Master Prompt (top, big editor)
- One large textarea labeled "Applied to every AI call across the platform."
- Live char counter, version dropdown, "Save as new version" / "Revert" buttons.
- A toggle: `Inject as: [System prefix] / [System suffix] / [User-message header]` — controls where it is concatenated.

### 2. Per-Surface Prompts (accordion list)
Each row = one editable system prompt. Surfaces:
- Assistant Chat
- Image Prompt Writer (covers, suspects, hint sheets, media)
- Image Prompt Writer — Envelope sub-mode
- Image Prompt Writer — Inline-image sub-mode
- Image Prompt Writer — Structured-doc sub-mode
- Document Generator (Claude Skills + fallback)
- Marketing Copy
- Storyboard
- Envelope Generator
- Canvas Arranger
- Canvas Node Explainer
- Logic Flow Generator
- Assistant Tweaks Editor

Each row shows: title, current version, "Reset to default" button (re-loads the hardcoded text shipped in code), "View default" diff modal, and an editor.

### 3. Live Test Panel (right side / drawer)
- Pick a surface from a dropdown.
- Optional: pick a project to use as context.
- Type a sample user input.
- Click "Preview assembled prompt" → shows the exact final prompt sent to the model (Master + surface override + per-call context).
- Click "Run test" → calls the surface and shows raw model output. Does not write to your real project.

## Technical plan (for the implementer / for your reference)

### Data model

New table: `system_prompts`
- `id uuid PK`
- `owner_id uuid` (workspace-scoped — tied to user, like profiles)
- `surface text` — `'master'`, `'assistant-chat'`, `'suggest-image-prompt:cover'`, `'suggest-image-prompt:inline-image'`, `'generate-document'`, etc.
- `body text` — the prompt text
- `injection_mode text` — `'system_prefix' | 'system_suffix' | 'user_header'` (master only; surfaces always replace)
- `version int` — monotonic per (owner_id, surface)
- `is_active bool` — exactly one active per (owner_id, surface)
- `notes text` — optional changelog
- `created_at`, `created_by`
- RLS: only owner can read/write their own rows; admins read all.

### Shared resolver

New file: `supabase/functions/_shared/system-prompts.ts`

```ts
export async function resolveSystemPrompt(opts: {
  supa: SupabaseClient;
  ownerId: string | null;
  surface: string;          // e.g. "suggest-image-prompt:inline-image"
  defaultBody: string;       // the hardcoded system prompt currently in the function
}): Promise<{ system: string; masterMode: 'system_prefix'|'system_suffix'|'user_header'|'none'; masterBody: string; surfaceVersion: number | null; masterVersion: number | null }>
```

Behavior:
1. Load active master (`surface = 'master'`) for ownerId. If none, masterBody = "".
2. Load active per-surface override. If none, use `defaultBody`.
3. Compose final system text per `injection_mode`.
4. Return both pieces + version numbers so we can log them.

### Wiring (per edge function)

In every function with a system prompt, replace:

```ts
const system = `...long hardcoded prompt...`;
```

with:

```ts
const DEFAULT_SYSTEM = `...long hardcoded prompt...`; // unchanged content
const resolved = await resolveSystemPrompt({
  supa, ownerId: profileOwnerId, surface: '<surface-key>', defaultBody: DEFAULT_SYSTEM,
});
// use resolved.system as the system message
// if resolved.masterMode === 'user_header', prepend resolved.masterBody to the user message instead
```

Then extend `logAiRun(...)` to also store `master_prompt_version` and `surface_prompt_version` (two new nullable columns on `ai_run_logs`).

### UI

- New route: `src/routes/settings.prompts.tsx` (TanStack Start file-based child of `settings.tsx`)
- Components:
  - `MasterPromptEditor.tsx` — textarea + version select + save/revert
  - `SurfacePromptList.tsx` — accordion of per-surface editors
  - `PromptTestDrawer.tsx` — surface picker, sample input, preview & run buttons
- Uses Tanstack Query, follows existing settings panel design tokens (no custom colors).

### Safety / guardrails

- Soft size cap: warn if Master Prompt > 4 KB (it gets prepended everywhere, costs tokens).
- "Reset to default" is always one click — code-shipped defaults are the source of truth backup.
- Live test panel never writes to real project rows.
- Version history retained forever (small text rows, cheap).

### Migration scope

- 1 SQL migration: create `system_prompts` table + RLS + add 2 columns to `ai_run_logs`.
- ~12 edge functions touched: each gets a 3-line resolver call instead of an inline `const system =` literal. The hardcoded text moves into a `DEFAULT_SYSTEM` constant in the same file (so nothing is lost and the fallback always works).
- 1 new shared helper file.
- 1 new settings route + 3 small components.

### Out of scope (for this first pass)

- Per-project system-prompt overrides (only workspace-level for now). Easy to add later by extending the table with a nullable `project_id`.
- Editing tool definitions / function-calling schemas of the assistant (separate, more dangerous surface).
- A/B testing prompts.

## What you get when this ships

- A `Settings → Prompt Studio` page where you can:
  - Write a Master Prompt that genuinely applies to every AI call.
  - Open any of the 12 surfaces and rewrite its system prompt.
  - Test changes against a sample input before saving.
  - Revert to a previous version or to the shipped default in one click.
- Origin badges on generated assets / chat messages will show "Master v3 · Surface v7" so you always know which prompt produced an output.

If this looks right, approve and I'll implement it. If you want it scoped smaller (e.g. start with just the Master Prompt + 4 highest-impact surfaces), tell me which surfaces matter most and I'll trim.

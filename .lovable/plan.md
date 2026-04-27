# View hardcoded defaults inside Prompt Studio

## Goal

For every surface listed in Prompt Studio, let you click "View default" and see exactly what the system prompt looks like — the same string the model receives when you have no override saved.

## Important caveat (read this first)

The "hardcoded default" for most surfaces is **not a single static string**. It's a template that's assembled at request time from:
- a fixed scaffold (rules, voice, output format)
- your assistant playbook + tweaks (Settings → Assistant rules)
- live project context (case brief, suspects, document list, approved logic, etc.)

So we can show you the default in two useful ways, and I'll build both:

- **Static template** — the fixed scaffold portion only, exactly as it lives in the edge function source. Good for "what are the baseline instructions?"
- **Live preview** — the fully assembled prompt for a specific project (you pick one), with all playbook + project context filled in. This is what the model actually sees.

## What you'll get in the UI

Inside each accordion item in Prompt Studio:

1. A **"View default template"** button → opens a read-only viewer with the static scaffold for that surface, plus a one-line note about what dynamic context gets merged in at runtime (e.g. "+ playbook identity/voice + project case brief + suspect list").
2. A **"Preview live for project…"** button → project picker, then calls a new edge function `preview-system-prompt` that runs the same assembly path and returns the final `system` string (and `userHeader` if your master prompt uses that mode), with the model call itself short-circuited. Output is shown in the same viewer with a "Copy" button.
3. A small **diff toggle** when you have an override saved, so you can see Default vs Your Override side-by-side.

## Surface coverage fix

While I'm in there, I'll also fix two surface-list gaps in `PromptStudioPanel.tsx`:
- `suggest-image-prompt:structured-doc` is wrong — the real surface keys are per-category: `suggest-image-prompt:cover`, `:suspect`, `:document`, `:hint`, `:media`. I'll replace the single entry with the real five.
- Add `generate-document-inline-image` (currently missing entirely).

## Technical changes

- **New edge function**: `supabase/functions/preview-system-prompt/index.ts`. Accepts `{ surface, projectId? }`, runs the same context-building code path as the real function but stops right after `resolveSystemPrompt` and returns `{ defaultBody, system, userHeader, masterVersion, surfaceVersion }`. Reuses the existing builders by extracting them into small helper functions where needed (`assistant-chat`, `generate-document`, `generate-envelopes`, etc.).
- **Static templates registry**: `supabase/functions/_shared/prompt-defaults.ts` exports a `STATIC_DEFAULTS: Record<surface, { template: string; dynamicNotes: string }>` map. Each surface's source file imports its template from here instead of inlining the string, so the registry stays automatically in sync. This is a mechanical refactor — no behavior change.
- **Frontend**: extend `SurfaceItem` in `PromptStudioPanel.tsx` with the two view buttons + a `<Dialog>` viewer component. Add a `useQuery` for the static template (fetched from a tiny new endpoint that just returns `STATIC_DEFAULTS[surface]`) and a `useMutation` for the live preview.
- **Surface catalog**: split `suggest-image-prompt:structured-doc` into the 5 real categories and add the inline-image generator entry.

## Out of scope for this pass

- Editing defaults from the UI (defaults stay in code; you override via the existing textarea).
- Per-project overrides (current model is per-user / per-workspace).

Approve and I'll ship it.

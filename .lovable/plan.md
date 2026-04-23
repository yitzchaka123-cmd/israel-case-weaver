

## Goal

One `GEMINI_API_KEY` (Google AI Studio) — yes, the same key powers both Gemini chat/text models and Nano Banana image generation. After this change, every model picker in the app will show **all Google models twice**:
- **Lovable AI route** — billed to your workspace credits
- **Your Gemini key route** — billed directly to your Google account (bypasses Lovable)

The user picks per-surface which route to use. If your direct key is missing, the "via your key" entries will fall back automatically — but the dropdown labels make the routing explicit.

## What's already in place (no work needed)

- `GeminiConnection` panel in Settings (paste/test/disconnect the key) — keep as-is.
- Backend `ai-router.ts` already routes `gemini-direct/<id>` to your key and `google/<id>` to Lovable Gateway.
- Backend `generate-image` already routes Nano Banana to your key when present.
- The connection panel already lists the 3 Nano Banana image models routed through this key. We'll add the chat models to that same panel for clarity.

## What's missing — the actual work

### 1. Text/chat model pickers — add the missing Google entries

There are two text-model pickers and one settings dropdown. Each is missing some Google models on one or both routes.

**`PromptWriterModelPicker`** (per-image prompt drafting — Cover, Suspect, Document, Media surfaces). Replace the model list with a clean grouped layout:

```text
— Lovable AI (workspace credits) —
  Gemini 3.1 Pro (preview)            [lovable / gemini-3-pro]
  Gemini 3 Flash (preview)            [gemini-3-flash]            ← NEW
  Gemini 2.5 Pro                      [gemini]
  Gemini 2.5 Flash                    [gemini-flash]
  Gemini 2.5 Flash Lite               [gemini-flash-lite]         ← NEW

— Your Google AI key (direct) —
  Gemini 2.5 Pro (direct)             [gemini-direct-pro]
  Gemini 2.5 Flash (direct)           [gemini-direct-flash]
  Gemini 2.5 Flash Lite (direct)      [gemini-direct-flash-lite]  ← NEW
  Gemini 3.1 Pro preview (direct)     [gemini-direct-3-pro]       ← NEW
  Gemini 3 Flash preview (direct)     [gemini-direct-3-flash]     ← NEW

— OpenAI / Anthropic — (unchanged)
```

**`LOGIC_FLOW_MODELS`** (`src/features/project/CanvasSection.tsx`, also surfaced in Settings → Logic Flow generator). Add the same two new "your Gemini key" preview entries plus Gemini 2.5 Flash direct so all three Google routes are representable on both sides.

**`Settings → AI provider routing`** (`SettingsPage.tsx`). The "Planning / Game design" and "Document generation" rows currently only let you pick `gemini-direct-pro` for the Google direct route. Expand them so you can pick **any** of the Lovable Gemini models (3.1 Pro, 3 Flash, 2.5 Pro, 2.5 Flash, 2.5 Flash Lite) or **any** of the direct Gemini models (Pro, Flash, Flash Lite, 3.1 Pro preview, 3 Flash preview).

### 2. Backend mappings — add the new keys

Add the new provider keys to `PROVIDER_MODEL` / `PLANNING_MODEL` in every edge function so the new dropdown entries actually resolve to a real model id:

- `assistant-chat/index.ts`
- `generate-document/index.ts`
- `generate-envelopes/index.ts`
- `generate-logic-flow/index.ts`
- `generate-marketing-copy/index.ts`
- `generate-storyboard/index.ts`
- `explain-canvas-node/index.ts`
- `suggest-image-prompt/index.ts`

New entries (added once, mirrored in each map):

```text
"gemini-3-flash":            "google/gemini-3-flash-preview"
"gemini-flash-lite":         "google/gemini-2.5-flash-lite"
"gemini-direct-flash-lite":  "gemini-direct/gemini-2.5-flash-lite"
"gemini-direct-3-pro":       "gemini-direct/gemini-3.1-pro-preview"
"gemini-direct-3-flash":     "gemini-direct/gemini-3-flash-preview"
```

No router changes needed — `ai-router.ts` already handles both `google/...` and `gemini-direct/...` prefixes.

### 3. Image picker — already complete

`ImageModelPicker` already lists all 3 Nano Banana variants and they already auto-route through your `GEMINI_API_KEY` when present. No change needed. We'll only update the small caption under each Nano Banana entry to be explicit:

```text
Currently routed via your Google key (free of Lovable credits).
```
…or, when the key is missing:
```text
Routed via Lovable AI Gateway. Connect your GEMINI_API_KEY in Settings to bypass.
```

(One-line conditional based on the existing `api-key-manager` "list" call already used by `GeminiConnection`.)

### 4. Settings → "Google Gemini" panel — extend the routed-models list

`GeminiConnection.tsx` currently lists just the 3 Nano Banana image models. Add a second sub-list of chat models routed through the same key:

```text
Image models routed through this key
  • Nano Banana            google/gemini-2.5-flash-image
  • Nano Banana 2          google/gemini-3.1-flash-image-preview
  • Nano Banana Pro        google/gemini-3-pro-image-preview

Chat / text models routed through this key
  • Gemini 2.5 Pro         gemini-direct/gemini-2.5-pro
  • Gemini 2.5 Flash       gemini-direct/gemini-2.5-flash
  • Gemini 2.5 Flash Lite  gemini-direct/gemini-2.5-flash-lite
  • Gemini 3.1 Pro preview gemini-direct/gemini-3.1-pro-preview
  • Gemini 3 Flash preview gemini-direct/gemini-3-flash-preview
```

Helps the user understand that one key covers both modalities.

## Validation

- Open **any** "Generate prompt" surface (Cover / Suspect / Document / Media) → dropdown shows all 5 Lovable Gemini entries AND all 5 direct Gemini entries.
- Settings → AI provider routing → Planning / Documents rows now offer every Gemini model on both routes.
- Settings → Logic Flow generator → dropdown lists Gemini 3.1 Pro preview direct, Gemini 3 Flash direct, etc.
- Generating with any new "direct" entry actually hits your Google account (no Lovable credits used) — verify by disconnecting the Lovable AI key in test or by inspecting the response `provider` field in the asset row (`gemini-direct`).
- Disconnecting `GEMINI_API_KEY` makes the direct entries fall back to Lovable Gateway with a clear inline error toast (existing behavior in `ai-router.ts`).
- ChatGPT Image and Anthropic options remain unchanged.

## Out of scope

- No DB migrations.
- No changes to OpenAI or Anthropic listings.
- No new edge function — purely additive entries in existing maps.


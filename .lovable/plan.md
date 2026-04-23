

## Add Claude models to the Assistant chat picker

The Assistant chat header has a "Chat" dropdown with only Gemini + ChatGPT options. The backend (`assistant-chat/index.ts`) already routes `claude`, `claude-opus`, and `claude-haiku` to the user's Anthropic account via `ANTHROPIC_API_KEY` — it's purely a UI gap.

### Heads-up: the Anthropic key isn't actually configured

Checked the project secrets — there's `OpenAi`, `LOVABLE_API_KEY`, `GEMINI_API_KEY`-related, but **no `ANTHROPIC_API_KEY`**. The dropdown will work (no errors at render), but picking Claude will fail at send time with "Anthropic API key (ANTHROPIC_API_KEY) is not configured".

After approving the plan I'll:
1. Make the UI change.
2. Prompt you to paste your Claude key into the secure form (you grab it from console.anthropic.com → Settings → API Keys).

### The UI change (single file)

**`src/features/project/AssistantSection.tsx`** — replace the flat `PLANNING_MODELS` array (lines 16–24) with a grouped list that mirrors the convention already used in `PromptWriterModelPicker` and `SettingsPage` (Lovable / Direct / OpenAI / Anthropic headers). Render headers as non-selectable separators in the `<Select>` body (same pattern as `PromptWriterModelPicker`).

New entries:

```text
— Lovable AI (workspace credits) —
  Gemini 3.1 Pro (default)             [lovable]
  Gemini 3 Flash (preview)             [gemini-3-flash]
  Gemini 2.5 Pro                       [gemini]
  Gemini 2.5 Flash                     [gemini-flash]
  Gemini 2.5 Flash Lite                [gemini-flash-lite]

— Your Google AI key (direct) —
  Gemini 3.1 Pro preview (direct)      [gemini-direct-3-pro]
  Gemini 3 Flash preview (direct)      [gemini-direct-3-flash]
  Gemini 2.5 Pro (direct)              [gemini-direct-pro]
  Gemini 2.5 Flash (direct)            [gemini-direct-flash]
  Gemini 2.5 Flash Lite (direct)       [gemini-direct-flash-lite]

— OpenAI —
  ChatGPT 5.4 (newest)                 [openai-5.4]
  ChatGPT 5.2                          [openai-5.2]
  ChatGPT 5                            [openai]
  ChatGPT 5 mini                       [openai-mini]

— Anthropic (your Claude key) —          ← NEW
  Claude Sonnet 4.5                    [claude]
  Claude Opus 4.5 (highest quality)    [claude-opus]
  Claude Haiku 4.5 (fast)              [claude-haiku]
```

All values already resolve in `assistant-chat/index.ts`'s `PROVIDER_MODEL` map — no backend edit needed.

### After the UI lands

I'll request the `ANTHROPIC_API_KEY` secret via the secure add-secret form. Once you paste it, the three Claude entries become live for the Assistant chat (and the Settings dropdowns that already list them).

### Out of scope

- No changes to image models, prompt-writer picker, or other generation surfaces.
- No DB / migration / edge function edits.
- No changes to Settings page (already exposes Claude correctly).


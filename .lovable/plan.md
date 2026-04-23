

## Add GPT-5.4 + a usage mini-dashboard in Settings → API keys

Two changes, both isolated:

### 1. Register GPT-5.4 as a selectable model

`ai-router.ts` already routes any `openai/*` id directly through your `OpenAi` secret — no router work needed. I'll just add the new short-key `openai-5.4` → `openai/gpt-5.4` to every `PROVIDER_MODEL` map and to every picker.

| File | Change |
|---|---|
| `supabase/functions/assistant-chat/index.ts` | Add `"openai-5.4": "openai/gpt-5.4"` to `PROVIDER_MODEL`. |
| `supabase/functions/generate-document/index.ts` | Same map entry. |
| `supabase/functions/generate-logic-flow/index.ts` | Same map entry. |
| `supabase/functions/explain-canvas-node/index.ts` | Same map entry. |
| `supabase/functions/suggest-image-prompt/index.ts` | Same map entry. |
| `src/features/project/AssistantSection.tsx` | Add `{ value: "openai-5.4", label: "ChatGPT 5.4 (newest)" }` at the top of the OpenAI group. |
| `src/features/project/CanvasSection.tsx` | Add `{ value: "openai-5.4", label: "ChatGPT 5.4 (newest · your OpenAI key)" }` to `LOGIC_FLOW_MODELS`. Default stays at 5.2 (tell me if you want 5.4 as default). |
| `src/components/PromptWriterModelPicker.tsx` | Add `{ value: "openai-5.4", label: "OpenAI GPT-5.4" }`. |

Note: like `gpt-image-2`, OpenAI may gate `gpt-5.4` behind org verification. If a 403 comes back the existing pass-through error message will surface OpenAI's text.

### 2. Usage mini-dashboard in Settings → API keys

A new `UsageDashboard` panel rendered above `ApiKeyManager`, showing **balance + 7-day spend graph** for each provider that exposes a usage API, plus an **"Add credits"** button that deep-links to the provider's billing page.

What it shows per provider — and the honest reality of what each one exposes:

| Provider | Balance | 7-day spend graph | Add credits link |
|---|---|---|---|
| **Lovable AI Gateway** | Not available via API. Show "Open Workspace → Usage" link instead. | Not available. | Button → `https://lovable.dev/dashboard` (Workspace → Usage) |
| **OpenAI** | Yes — fetched via `https://api.openai.com/v1/organization/costs` (returns USD spent in window; "remaining" only meaningful if you've set a hard limit, which we surface if present). | Yes — daily buckets from the same costs endpoint. | Button → `https://platform.openai.com/settings/organization/billing` |
| **Anthropic** | Anthropic does **not** expose balance via API. | Not available. | Button → `https://console.anthropic.com/settings/billing` |
| **Google Gemini (direct)** | Google AI Studio does **not** expose balance via API (free tier + paid tier billed via GCP). | Not available. | Button → `https://aistudio.google.com/app/apikey` |

So in practice the **only** provider with real numbers + chart is **OpenAI**. The other three get a card with a "Check usage" button that opens their billing page in a new tab — clearly labeled "API doesn't expose usage; opens external dashboard." This avoids fake/empty graphs.

#### Implementation

| File | Change |
|---|---|
| `supabase/functions/api-key-manager/index.ts` | Add new actions:<br>• `usage_openai` → calls `GET https://api.openai.com/v1/organization/costs?start_time=…&bucket_width=1d&limit=7` with `Authorization: Bearer ${OpenAi}`. Returns `{ daily: [{date, usd}], total7d, currency, limitUsd? }`. Limits via `/v1/organization/usage_limits` if available; gracefully omit on error.<br>• `usage_summary` → returns `{ openai: <result-or-error>, lovable: { available: false, reason: "no API" }, anthropic: { available: false }, gemini: { available: false } }` so the UI gets one round-trip. |
| `src/features/settings/UsageDashboard.tsx` (new) | New component. Calls `usage_summary`, renders 4 cards in a 2-col grid:<br>• OpenAI card: big number (7-day spend in USD), tiny sparkline using `recharts` `<AreaChart>`, "Add credits" button.<br>• Lovable, Anthropic, Gemini cards: muted card with provider name, "API doesn't expose usage" microcopy, "Open billing" button. |
| `src/features/settings/SettingsPage.tsx` | Render `<UsageDashboard />` inside a new `<Section title="Usage & credits" desc="…">` placed **right above** the existing "API keys" section. |

The OpenAI graph uses `recharts` (already installed via shadcn `chart.tsx`). Sparkline is ~120px tall, accent-colored area. Loading state = skeleton. Error state (e.g. key not set, or org doesn't have `api.usage.read` scope) shows: "Couldn't load OpenAI usage — your key may lack the `api.usage.read` scope. Create a new key with that scope at platform.openai.com."

#### Caveats worth knowing

- The **OpenAI Costs API** requires an **admin key** or a key with the `api.usage.read` scope. Standard project keys don't have it. If your current `OpenAi` secret is a project key, the dashboard will show the scope error with instructions — no app code change needed, just paste a new admin/usage-scoped key when you want the data.
- All numbers come from the provider's API at view time — no caching, no DB writes.

### What stays the same

- `ai-router.ts` — already correct.
- Lovable AI gateway models, Anthropic direct, Gemini direct routing — untouched.
- Existing "API keys" panel and edge function — extended, not replaced.


// API Key manager — reports presence of allowed secrets and tests them with a
// lightweight, low-cost ping. Never returns the actual key values.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Allowed secret names this function will inspect/test. Add more as needed.
const ALLOWED_KEYS = [
  { name: "OpenAi", label: "OpenAI API key", provider: "openai" as const },
  { name: "OPENAI_API_KEY", label: "OpenAI API key (alt)", provider: "openai" as const },
  { name: "OPENAI_IMAGE2_API_KEY", label: "OpenAI API key (Image 2 dedicated)", provider: "openai" as const },
  { name: "LOVABLE_API_KEY", label: "Lovable AI Gateway", provider: "lovable" as const, managed: true },
  { name: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", provider: "anthropic" as const },
  { name: "GEMINI_API_KEY", label: "Google Gemini (direct)", provider: "gemini" as const },
];

type TestResult = { ok: boolean; status?: number; detail?: string; latencyMs?: number };

async function testKey(name: string, provider: string): Promise<TestResult> {
  const key = Deno.env.get(name) ?? "";
  if (!key) return { ok: false, detail: "not set" };
  const t0 = Date.now();
  try {
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const ok = r.ok;
      let detail = "";
      if (!ok) {
        try { const j = await r.json(); detail = j?.error?.message ?? r.statusText; } catch { detail = r.statusText; }
      }
      return { ok, status: r.status, detail: ok ? "valid" : detail, latencyMs: Date.now() - t0 };
    }
    if (provider === "lovable") {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      // 200 = OK, 402 = out of credits but key valid, 429 = rate limit but key valid
      const keyValid = r.ok || r.status === 402 || r.status === 429;
      let detail = r.ok ? "valid" : r.status === 402 ? "valid (out of credits)" : r.status === 429 ? "valid (rate-limited)" : r.statusText;
      return { ok: keyValid, status: r.status, detail, latencyMs: Date.now() - t0 };
    }
    if (provider === "anthropic") {
      // Try a tiny chat completion against the current Haiku model.
      // If it 404s (model id moved), fall back to GET /v1/models so we can
      // still verify the key is good and report which models it can see.
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      if (r.ok) {
        return { ok: true, status: r.status, detail: "valid (claude-haiku-4-5)", latencyMs: Date.now() - t0 };
      }
      // 401/403 = bad key. 404 = model id stale but key likely fine — verify via /v1/models.
      let firstDetail = r.statusText;
      try { const j = await r.json(); firstDetail = j?.error?.message ?? firstDetail; } catch { /* */ }
      if (r.status === 401 || r.status === 403) {
        return { ok: false, status: r.status, detail: firstDetail, latencyMs: Date.now() - t0 };
      }
      // Fall back to listing models — succeeds whenever the key itself is valid.
      const lr = await fetch("https://api.anthropic.com/v1/models?limit=5", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      if (lr.ok) {
        let names = "";
        try {
          const lj = await lr.json();
          const ids = (lj?.data ?? []).map((m: { id?: string }) => m.id).filter(Boolean).slice(0, 3);
          names = ids.length ? ` · sees ${ids.join(", ")}` : "";
        } catch { /* */ }
        return { ok: true, status: lr.status, detail: `valid (chat ping 404 — model id moved)${names}`, latencyMs: Date.now() - t0 };
      }
      let lDetail = lr.statusText;
      try { const lj = await lr.json(); lDetail = lj?.error?.message ?? lDetail; } catch { /* */ }
      return { ok: false, status: lr.status, detail: lDetail, latencyMs: Date.now() - t0 };
    }
    if (provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      return { ok: r.ok, status: r.status, detail: r.ok ? "valid" : r.statusText, latencyMs: Date.now() - t0 };
    }
    return { ok: false, detail: "unknown provider" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "network error" };
  }
}

function maskHint(name: string): string | null {
  const v = Deno.env.get(name);
  if (!v) return null;
  if (v.length < 10) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)} (${v.length} chars)`;
}

// ---------------- OpenAI usage ----------------
type DailyPoint = { date: string; usd: number };
type OpenAiUsage =
  | { available: true; daily: DailyPoint[]; total7d: number; currency: string; hardLimitUsd: number | null }
  | { available: false; reason: string; needsScope?: boolean };

async function fetchOpenAiUsage(): Promise<OpenAiUsage> {
  const key = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!key) return { available: false, reason: "OpenAI key not configured. Add the OpenAi secret in Settings → API keys." };

  const now = new Date();
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6);
  const startSec = Math.floor(startMs / 1000);

  try {
    const url = `https://api.openai.com/v1/organization/costs?start_time=${startSec}&bucket_width=1d&limit=7`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) {
      let msg = r.statusText;
      try { const j = await r.json(); msg = j?.error?.message ?? msg; } catch { /* */ }
      const needsScope = r.status === 401 || r.status === 403 || /scope|admin|permission/i.test(msg);
      return {
        available: false,
        needsScope,
        reason: needsScope
          ? `Your OpenAI key lacks the api.usage.read scope (or isn't an admin key). Create an admin key at platform.openai.com → Settings → Admin keys with api.usage.read enabled, then replace the OpenAi secret. (${r.status}: ${msg})`
          : `OpenAI usage API error (${r.status}): ${msg}`,
      };
    }
    const j = await r.json();
    const buckets: Array<Record<string, unknown>> = Array.isArray(j?.data) ? j.data : [];
    const daily: DailyPoint[] = buckets.map((b) => {
      const startTime = Number((b as { start_time?: number }).start_time ?? 0);
      const results = ((b as { results?: Array<Record<string, unknown>> }).results ?? []) as Array<{ amount?: { value?: number; currency?: string } }>;
      const usd = results.reduce((sum, r) => sum + (Number(r?.amount?.value) || 0), 0);
      const date = new Date(startTime * 1000).toISOString().slice(0, 10);
      return { date, usd: Math.round(usd * 1e4) / 1e4 };
    });
    const total7d = Math.round(daily.reduce((a, b) => a + b.usd, 0) * 100) / 100;
    const currency = (buckets[0] as { results?: Array<{ amount?: { currency?: string } }> })?.results?.[0]?.amount?.currency ?? "usd";

    let hardLimitUsd: number | null = null;
    try {
      const lr = await fetch("https://api.openai.com/v1/organization/usage_limits", { headers: { Authorization: `Bearer ${key}` } });
      if (lr.ok) {
        const lj = await lr.json();
        const v = Number(lj?.hard_limit_usd ?? lj?.hard_limit ?? lj?.data?.hard_limit_usd);
        if (Number.isFinite(v) && v > 0) hardLimitUsd = v;
      }
    } catch { /* ignore */ }

    return { available: true, daily, total7d, currency: String(currency).toLowerCase(), hardLimitUsd };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : "network error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? (req.method === "POST" ? (await req.clone().json().catch(() => ({}))).action : "list");

    if (action === "list") {
      const keys = ALLOWED_KEYS.map((k) => ({
        name: k.name,
        label: k.label,
        provider: k.provider,
        managed: k.managed ?? false,
        present: !!Deno.env.get(k.name),
        hint: maskHint(k.name),
      }));
      return new Response(JSON.stringify({ keys }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "test") {
      const body = await req.json().catch(() => ({}));
      const name: string = body.name ?? "";
      const entry = ALLOWED_KEYS.find((k) => k.name === name);
      if (!entry) {
        return new Response(JSON.stringify({ error: "Unknown key name" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await testKey(entry.name, entry.provider);
      return new Response(JSON.stringify({ name: entry.name, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "test_all") {
      const results = await Promise.all(
        ALLOWED_KEYS.filter((k) => !!Deno.env.get(k.name)).map(async (k) => ({
          name: k.name,
          ...(await testKey(k.name, k.provider)),
        }))
      );
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "usage_openai") {
      const result = await fetchOpenAiUsage();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "usage_summary") {
      const openai = await fetchOpenAiUsage();
      return new Response(
        JSON.stringify({
          openai,
          lovable: { available: false, reason: "Lovable AI Gateway doesn't expose per-key usage via API. Open your Workspace → Usage page." },
          anthropic: { available: false, reason: "Anthropic doesn't expose balance/usage via API. Open the Anthropic console billing page." },
          gemini: { available: false, reason: "Google AI Studio doesn't expose balance/usage via API. Open the AI Studio billing page in Google Cloud." },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("api-key-manager error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

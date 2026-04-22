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
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      const ok = r.ok;
      let detail = ok ? "valid" : r.statusText;
      if (!ok) { try { const j = await r.json(); detail = j?.error?.message ?? detail; } catch { /* */ } }
      return { ok, status: r.status, detail, latencyMs: Date.now() - t0 };
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

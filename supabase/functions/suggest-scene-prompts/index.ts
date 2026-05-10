// suggest-scene-prompts — returns 4 short scene labels + prompts for the
// "in-game scenes" panel of a project. One LLM call, JSON output.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body { projectId: string; hint?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { projectId, hint } = (await req.json()) as Body;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: p } = await supa.from("projects")
      .select("title, subtitle, mystery_type, setting, genre, year")
      .eq("id", projectId).maybeSingle();

    const sys = `You suggest in-game scene illustrations for the back of a boxed murder-mystery game. Return STRICT JSON: {"scenes":[{"label":"…","prompt":"…"} x4]}. Labels are 1–3 words (e.g. "Drawing room", "Bloody letter"). Prompts are 1–2 sentences describing a single evocative spoiler-free moment from inside the case world. No on-image text, no faces of suspects.`;
    const user = `Project: ${JSON.stringify(p ?? {})}\nWriter hint: ${hint ?? "(none)"}\nReturn 4 distinct, complementary scenes that share the same world.`;

    const r = await chatCompletions({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `LLM ${r.status}: ${t.slice(0, 300)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { scenes?: Array<{ label?: string; prompt?: string }> } = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const scenes = (parsed.scenes ?? []).slice(0, 4);
    while (scenes.length < 4) scenes.push({ label: `Scene ${scenes.length + 1}`, prompt: "" });
    return new Response(JSON.stringify({ scenes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

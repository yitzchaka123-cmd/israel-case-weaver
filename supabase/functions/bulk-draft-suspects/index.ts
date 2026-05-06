// Draft text fields (summary / role_in_case / motives / secrets / contradictions)
// for every suspect in a project that's missing them. Runs each suspect through
// one chatCompletions tool-call using the project's planning model. Returns a
// summary of how many were filled / failed; the client polls `suspects` via
// realtime to see live updates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  chatCompletions,
  providerLabel,
  extractFallback,
  logAiRun,
  getUserIdFromAuth,
} from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-3.1-pro-preview",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.4": "openai/gpt-5.2",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

interface Suspect {
  id: string;
  name: string | null;
  role_in_case: string | null;
  summary: string | null;
  motives: string | null;
  secrets: string | null;
  contradictions: string | null;
  is_red_herring: boolean;
  thumbnail_prompt: string | null;
  thumbnail_url: string | null;
  uploaded_thumbnail_url: string | null;
}

const CONCURRENCY = 3;

async function draftOne(opts: {
  supa: ReturnType<typeof createClient>;
  s: Suspect;
  caseContext: string;
  model: string;
  gameLanguage: string;
  projectId: string;
  callerUserId: string | null;
}): Promise<"ok" | "skip" | "fail"> {
  const { supa, s, caseContext, model, gameLanguage, projectId, callerUserId } = opts;

  const tool = {
    type: "function",
    function: {
      name: "emit_suspect",
      description: "Return drafted text fields for this suspect.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name (only emit if currently empty/placeholder)" },
          role_in_case: { type: "string", description: "1-line role: profession, relationship to victim/case." },
          summary: { type: "string", description: "2–4 sentence in-character profile a player would read on the suspect card." },
          motives: { type: "string", description: "Why this person could plausibly want the victim harmed (or why they look like they might). 2–3 sentences." },
          secrets: { type: "string", description: "Private fact the suspect is hiding from investigators (may be unrelated to the murder for red herrings)." },
          contradictions: { type: "string", description: "What in their statement / alibi does NOT line up with the rest of the case file. 1–2 short bullets." },
          thumbnail_prompt: { type: "string", description: "40–80 word photoreal portrait brief: apparent age, ethnicity/build, hair, distinctive features, wardrobe, lighting/mood. Period-appropriate. English." },
        },
        required: ["role_in_case", "summary", "motives", "secrets", "contradictions", "thumbnail_prompt"],
        additionalProperties: false,
      },
    },
  };

  const sys = `You are a senior boxed-mystery game designer drafting one suspect entry for a ${gameLanguage} murder-mystery game. Output a single JSON tool call. No prose.

CRITICAL:
- Stay consistent with the approved case context below — never invent a different culprit, motive, or murder method.
- ${s.is_red_herring ? "This suspect is a RED HERRING. Their secrets and contradictions should look suspicious but ultimately not prove guilt." : "This suspect is part of the real suspect pool — keep their guilt/innocence ambiguous, don't reveal whether they did it."}
- Voice: investigative case-file voice. Concrete, specific, period-appropriate.
- Player-facing fields (summary) in ${gameLanguage}. Internal designer fields (motives / secrets / contradictions) may stay in English unless the project is in another language.`;

  const user = `CASE CONTEXT
${caseContext}

EXISTING SUSPECT RECORD (fill in or refine the empty/placeholder fields — keep any non-empty field as-is unless it conflicts with the case):
- name: ${s.name ?? "(blank)"}
- role_in_case: ${s.role_in_case ?? "(blank)"}
- summary: ${s.summary ?? "(blank)"}
- motives: ${s.motives ?? "(blank)"}
- secrets: ${s.secrets ?? "(blank)"}
- contradictions: ${s.contradictions ?? "(blank)"}
- is_red_herring: ${s.is_red_herring}

Draft the suspect now.`;

  const startedAt = Date.now();
  const resp = await chatCompletions({
    model,
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    tools: [tool],
    tool_choice: { type: "function", function: { name: "emit_suspect" } },
  });
  const fb = extractFallback(resp, model);

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    await logAiRun({
      userId: callerUserId, projectId, surface: "bulk-draft-suspects",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "error", latencyMs: Date.now() - startedAt, targetId: s.id,
      errorMessage: `${providerLabel(model)} ${resp.status}: ${t.slice(0, 200)}`,
    });
    return "fail";
  }
  const data = await resp.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!call) return "fail";
  let parsed: Record<string, string>;
  try { parsed = JSON.parse(call); } catch { return "fail"; }

  // Only fill blanks (don't overwrite anything the user has already written).
  const patch: Record<string, string> = {};
  const fields: (keyof Suspect)[] = ["name", "role_in_case", "summary", "motives", "secrets", "contradictions", "thumbnail_prompt"];
  for (const f of fields) {
    const current = (s[f] as string | null) ?? "";
    const next = (parsed[f as string] ?? "").trim();
    if (!current.trim() && next) patch[f as string] = next;
  }
  if (Object.keys(patch).length === 0) {
    await logAiRun({
      userId: callerUserId, projectId, surface: "bulk-draft-suspects",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "ok", latencyMs: Date.now() - startedAt, targetId: s.id,
      errorMessage: "no-op (all fields already filled)",
    });
    return "skip";
  }
  await supa.from("suspects").update(patch).eq("id", s.id);
  await logAiRun({
    userId: callerUserId, projectId, surface: "bulk-draft-suspects",
    requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
    status: "ok", latencyMs: Date.now() - startedAt, targetId: s.id,
  });
  return "ok";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, modelOverride, overwrite } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SERVICE);

    const { data: project, error: pErr } = await supa
      .from("projects").select("*").eq("id", projectId).single();
    if (pErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: suspects } = await supa
      .from("suspects").select("*").eq("project_id", projectId).order("position");
    const all = (suspects ?? []) as Suspect[];
    const todo = overwrite
      ? all
      : all.filter((s) =>
          !((s.summary ?? "").trim()) ||
          !((s.role_in_case ?? "").trim()) ||
          !((s.motives ?? "").trim()) ||
          !((s.secrets ?? "").trim()) ||
          !((s.contradictions ?? "").trim()) ||
          !((s.thumbnail_prompt ?? "").trim()),
        );

    if (todo.length === 0) {
      return new Response(JSON.stringify({ ok: true, total: all.length, drafted: 0, failed: 0, skipped: 0, message: "All suspects already drafted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const modelKey = (modelOverride as string) || (project.ai_provider_planning as string) || "lovable";
    const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL.lovable;
    const gameLanguage = String(project.game_language ?? "Hebrew").trim() || "Hebrew";
    const callerUserId = await getUserIdFromAuth(req);

    const caseContext = `Title: ${project.title}
Game language: ${gameLanguage}
Year/Setting: ${project.year ?? "—"} · ${project.setting ?? "—"}
Genre: ${project.genre ?? "mystery"} · Type: ${project.mystery_type ?? "—"} · Difficulty: ${project.difficulty ?? "—"}
Player role: ${project.player_role ?? "—"}
Case goal: ${project.case_goal ?? "—"}
Solution summary: ${project.solution_summary ?? "(not yet written)"}`;

    // Run with concurrency.
    let cursor = 0;
    let ok = 0, skipped = 0, failed = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= todo.length) return;
        const r = await draftOne({ supa, s: todo[i], caseContext, model, gameLanguage, projectId, callerUserId }).catch(() => "fail" as const);
        if (r === "ok") ok++;
        else if (r === "skip") skipped++;
        else failed++;
      }
    });
    await Promise.all(workers);

    return new Response(JSON.stringify({ ok: true, total: todo.length, drafted: ok, skipped, failed, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bulk-draft-suspects error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

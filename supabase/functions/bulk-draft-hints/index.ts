// Draft hint text for every (stage, level) slot across all stages in a project.
// For each stage, asks the model in one tool call for the full ladder
// (vague → helpful → reveal) so the three levels stay coherent. Only fills
// empty `hints.text` fields unless `overwrite` is true.
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

interface HintRow {
  id: string;
  project_id: string;
  stage: number;
  level: number;
  text: string | null;
}

const CONCURRENCY = 3;

async function draftStage(opts: {
  supa: ReturnType<typeof createClient>;
  stage: number;
  rows: HintRow[]; // up to 3 rows for levels 1..3
  caseContext: string;
  envelopeContext: string;
  model: string;
  gameLanguage: string;
  projectId: string;
  callerUserId: string | null;
  overwrite: boolean;
}): Promise<{ filled: number; failed: number }> {
  const { supa, stage, rows, caseContext, envelopeContext, model, gameLanguage, projectId, callerUserId, overwrite } = opts;
  const isRtl = ["Hebrew", "Arabic", "Persian", "Urdu", "Yiddish"].includes(gameLanguage);

  const byLevel = new Map<number, HintRow>();
  rows.forEach((r) => byLevel.set(r.level, r));
  const needs = [1, 2, 3].filter((l) => {
    const r = byLevel.get(l);
    if (!r) return true;
    return overwrite || !((r.text ?? "").trim());
  });
  if (needs.length === 0) return { filled: 0, failed: 0 };

  const tool = {
    type: "function",
    function: {
      name: "emit_stage_hints",
      description: "Return the three-level hint ladder for one stage.",
      parameters: {
        type: "object",
        properties: {
          level1: { type: "string", description: "Vague nudge — points the player back to where to look without naming the answer." },
          level2: { type: "string", description: "More helpful — narrows the search space, still no spoilers." },
          level3: { type: "string", description: "Reveals the task — explicitly says what the player needs to do or notice next." },
        },
        required: ["level1", "level2", "level3"],
        additionalProperties: false,
      },
    },
  };

  const sys = `You are a senior boxed-mystery game designer writing the printable hint ladder for one stage of a ${gameLanguage} murder-mystery game.

THE HINT LADDER (locked):
- Level 1 — Vague nudge. Reorients the player. Never names the answer.
- Level 2 — More helpful. Narrows the search space.
- Level 3 — Reveals the task. Explicitly tells the player what to do or notice.

Output language: ${gameLanguage}, ${isRtl ? "RTL" : "LTR"}. 1–3 short sentences per level. Direct, friendly, in second person ("you"). Do NOT name the culprit, motive, or murder method even at level 3 — reveal the task / what to look at, not the solution.`;

  const user = `CASE CONTEXT
${caseContext}

ENVELOPE / STAGE FLOW (so this stage's hints match the right beat):
${envelopeContext}

CURRENT STAGE: ${stage}

Write the three-level hint ladder for stage ${stage} now.`;

  const startedAt = Date.now();
  const resp = await chatCompletions({
    model,
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    tools: [tool],
    tool_choice: { type: "function", function: { name: "emit_stage_hints" } },
  });
  const fb = extractFallback(resp, model);

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    await logAiRun({
      userId: callerUserId, projectId, surface: "bulk-draft-hints",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "error", latencyMs: Date.now() - startedAt,
      errorMessage: `${providerLabel(model)} ${resp.status}: ${t.slice(0, 200)} (stage ${stage})`,
    });
    return { filled: 0, failed: needs.length };
  }
  const data = await resp.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!call) return { filled: 0, failed: needs.length };
  let parsed: { level1?: string; level2?: string; level3?: string };
  try { parsed = JSON.parse(call); } catch { return { filled: 0, failed: needs.length }; }

  let filled = 0;
  for (const lvl of needs) {
    const text = (parsed[`level${lvl}` as keyof typeof parsed] ?? "").trim();
    if (!text) continue;
    const existing = byLevel.get(lvl);
    if (existing) {
      await supa.from("hints").update({ text }).eq("id", existing.id);
    } else {
      await supa.from("hints").insert({ project_id: projectId, stage, level: lvl, text });
    }
    filled++;
  }
  await logAiRun({
    userId: callerUserId, projectId, surface: "bulk-draft-hints",
    requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
    status: "ok", latencyMs: Date.now() - startedAt, targetId: null,
  });
  return { filled, failed: needs.length - filled };
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

    const { data: hints } = await supa
      .from("hints").select("*").eq("project_id", projectId).order("stage").order("level");
    const all = (hints ?? []) as HintRow[];
    if (all.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No hint stages yet — add a stage first.", stages: 0, filled: 0, failed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by stage.
    const byStage = new Map<number, HintRow[]>();
    for (const h of all) {
      if (!byStage.has(h.stage)) byStage.set(h.stage, []);
      byStage.get(h.stage)!.push(h);
    }

    const { data: envs } = await supa
      .from("envelopes").select("number, label, task").eq("project_id", projectId).order("number");
    const envelopeContext = (envs ?? [])
      .map((e) => `#${e.number} ${e.label ?? ""}${e.task ? ` — ${String(e.task).slice(0, 220)}…` : ""}`)
      .join("\n") || "(no envelopes drafted yet)";

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

    const stages = Array.from(byStage.keys()).sort((a, b) => a - b);
    let cursor = 0;
    let filled = 0;
    let failed = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, stages.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= stages.length) return;
        const stage = stages[i];
        const r = await draftStage({
          supa, stage, rows: byStage.get(stage) ?? [],
          caseContext, envelopeContext, model, gameLanguage, projectId, callerUserId,
          overwrite: !!overwrite,
        }).catch(() => ({ filled: 0, failed: 3 }));
        filled += r.filled;
        failed += r.failed;
      }
    });
    await Promise.all(workers);

    return new Response(JSON.stringify({ ok: true, stages: stages.length, filled, failed, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bulk-draft-hints error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

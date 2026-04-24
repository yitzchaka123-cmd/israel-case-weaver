// Storyboard generator. Two modes:
//   mode: "script" — generates a structured shot list for a chosen length (s).
//   mode: "prompt" — generates an engine-specific (Sora 2 / Kling 3) video prompt
//                    for one shot.
//
// Body for "script":
//   { projectId, mode: "script", length_seconds: 30|60|90|120,
//     script_instructions?: string }
// Returns: { shots: [{ n, duration_s, action, voiceover, on_screen_text }], model }
//
// Body for "prompt":
//   { projectId, mode: "prompt", engine: "sora" | "kling",
//     shot: { n, duration_s, action, voiceover?, on_screen_text? },
//     engine_instructions?: string }
// Returns: { prompt: string, model }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { claudeSkillPromptBlock, loadClaudeSkillsForSurface, withClaudeSkills } from "../_shared/claude-skills.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PLANNING_MODEL: Record<string, string> = {
  lovable: "google/gemini-2.5-flash",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.4": "openai/gpt-5.4",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "claude-haiku": "anthropic/claude-haiku-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

const SHOT_COUNT_BY_LEN: Record<number, number> = { 30: 6, 60: 10, 90: 14, 120: 18 };

type Mode = "script" | "prompt";
type Engine = "sora" | "kling";

interface ScriptBody {
  projectId: string;
  mode: "script";
  length_seconds: number;
  script_instructions?: string;
}
interface PromptBody {
  projectId: string;
  mode: "prompt";
  engine: Engine;
  engine_instructions?: string;
  shot: {
    n: number;
    duration_s: number;
    action: string;
    voiceover?: string;
    on_screen_text?: string;
  };
}
type Body = ScriptBody | PromptBody;

async function projectContext(supa: ReturnType<typeof createClient>, projectId: string) {
  const { data: project } = await supa
    .from("projects")
    .select("title, subtitle, genre, mystery_type, setting, year, player_role, case_goal, selling_point, game_language, ai_provider_planning, owner_id")
    .eq("id", projectId)
    .single();
  if (!project) return null;
  const { data: suspects } = await supa
    .from("suspects")
    .select("name, role_in_case")
    .eq("project_id", projectId)
    .order("position")
    .limit(8);
  const ctx = [
    project.title && `Title: ${project.title}`,
    project.subtitle && `Subtitle: ${project.subtitle}`,
    project.genre && `Genre: ${project.genre}`,
    project.mystery_type && `Mystery type: ${project.mystery_type}`,
    project.setting && `Setting: ${project.setting}`,
    project.year && `Year: ${project.year}`,
    project.player_role && `Player role: ${project.player_role}`,
    project.case_goal && `Case goal: ${project.case_goal}`,
    project.selling_point && `Selling point: ${project.selling_point}`,
    `Game language: ${project.game_language ?? "Hebrew"}`,
    suspects?.length && `Key characters: ${suspects.map((s) => `${s.name}${s.role_in_case ? ` (${s.role_in_case})` : ""}`).join("; ")}`,
  ].filter(Boolean).join("\n");
  return { project, ctx };
}

function modelFor(planningKey: string | null | undefined): string {
  return PLANNING_MODEL[planningKey ?? "lovable"] ?? PLANNING_MODEL.lovable;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { projectId } = body;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    const ctxData = await projectContext(supa, projectId);
    if (!ctxData) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const model = modelFor(ctxData.project.ai_provider_planning as string | null);
    const callerUserId = await getUserIdFromAuth(req);
    const enabledSkills = model.startsWith("anthropic/") ? await loadClaudeSkillsForSurface(supa, "media") : [];

    if (body.mode === "script") {
      const lenRaw = Number(body.length_seconds || 60);
      const len = ([30, 60, 90, 120] as const).includes(lenRaw as 30 | 60 | 90 | 120) ? lenRaw : 60;
      const shotCount = SHOT_COUNT_BY_LEN[len] ?? 10;
      const perShot = Math.round((len / shotCount) * 10) / 10;

      const system = `You are a trailer director for premium boxed murder-mystery games. You write tight, cinematic, dialogue-light shot lists. Output ONLY a JSON object with key "shots" — a flat array. No preamble, no markdown.\n\n${claudeSkillPromptBlock(enabledSkills, "media")}`;
      const userMsg = `PROJECT CONTEXT:
${ctxData.ctx}

${body.script_instructions ? `EXTRA INSTRUCTIONS:\n${body.script_instructions}\n\n` : ""}Write a ${len}-second promo trailer in ${shotCount} shots. Each shot ~${perShot}s. Genre-appropriate atmosphere. NEVER spoil the solution.

Each shot must have:
  - n (number, 1..${shotCount})
  - duration_s (number, sums to ~${len})
  - action (one sentence: what we see)
  - voiceover (optional, max 12 words; can be empty string)
  - on_screen_text (optional short text overlay; empty string if none)

Return: {"shots": [ ... ]}`;

      const startedAt = Date.now();
      const resp = await chatCompletions(withClaudeSkills({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        temperature: 0.85,
        response_format: { type: "json_object" },
      }, enabledSkills));
      const fb = extractFallback(resp, model);

      if (!resp.ok) {
        const t = await resp.text();
        console.error("storyboard script provider error", resp.status, t);
        const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
        await logAiRun({
          userId: callerUserId, projectId, surface: "generate-storyboard",
          requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
          status: "error", latencyMs: Date.now() - startedAt,
          errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`, promptExcerpt: userMsg,
        });
        if (resp.status === 402) {
          return new Response(JSON.stringify({ error: `${provider} credits/key issue (status 402). Add credits in Settings → Workspace → Usage, or switch this project's planning provider.` }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const text = (data.choices?.[0]?.message?.content ?? "").trim();
      let parsed: { shots?: unknown } = {};
      try { parsed = JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) try { parsed = JSON.parse(m[0]); } catch { /* */ }
      }
      const shots = Array.isArray(parsed.shots) ? parsed.shots.map((s, i) => {
        const o = (s ?? {}) as Record<string, unknown>;
        return {
          n: Number(o.n) || i + 1,
          duration_s: Number(o.duration_s) || perShot,
          action: String(o.action ?? "").trim(),
          voiceover: String(o.voiceover ?? "").trim(),
          on_screen_text: String(o.on_screen_text ?? "").trim(),
        };
      }) : [];
      if (shots.length === 0) {
        return new Response(JSON.stringify({ error: "Model returned no shots" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await logAiRun({
        userId: callerUserId, projectId, surface: "generate-storyboard",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt: userMsg,
      });
      return new Response(JSON.stringify({ shots, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.mode === "prompt") {
      const engine = body.engine === "kling" ? "Kling 3" : "Sora 2";
      const shot = body.shot;
      const system = `You write expert text-to-video prompts for ${engine}. Output ONLY the final prompt — no preamble, no quotes, no markdown. Be specific about subject, camera move, lens/focal length, lighting, palette, mood, era, and pacing for a single ~${Math.round(shot.duration_s)}s shot. NO scene-by-scene cuts.\n\n${claudeSkillPromptBlock(enabledSkills, "media")}`;
      const userMsg = `PROJECT CONTEXT:
${ctxData.ctx}

SHOT #${shot.n} (~${shot.duration_s}s)
ACTION: ${shot.action}
VOICEOVER: ${shot.voiceover || "(none)"}
ON-SCREEN TEXT: ${shot.on_screen_text || "(none)"}

${body.engine_instructions ? `${engine.toUpperCase()} STYLE INSTRUCTIONS:\n${body.engine_instructions}\n` : ""}
Write the ${engine} prompt now.`;

      const startedAt = Date.now();
      const resp = await chatCompletions(withClaudeSkills({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        temperature: 0.85,
      }, enabledSkills));
      const fb = extractFallback(resp, model);

      if (!resp.ok) {
        const t = await resp.text();
        console.error("storyboard prompt provider error", resp.status, t);
        const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
        await logAiRun({
          userId: callerUserId, projectId, surface: "generate-storyboard",
          requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
          status: "error", latencyMs: Date.now() - startedAt,
          errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`, promptExcerpt: userMsg,
        });
        if (resp.status === 402) {
          return new Response(JSON.stringify({ error: `${provider} credits/key issue (status 402). Add credits in Settings → Workspace → Usage.` }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const text = (data.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        return new Response(JSON.stringify({ error: "Model returned an empty prompt" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await logAiRun({
        userId: callerUserId, projectId, surface: "generate-storyboard",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt: userMsg,
      });
      return new Response(JSON.stringify({ prompt: text, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "mode must be 'script' or 'prompt'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-storyboard error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

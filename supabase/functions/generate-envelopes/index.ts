// Generate all envelopes for a project in one shot — produces label, task,
// and design_instructions for every envelope slot defined by the playbook.
// Reuses existing rows by `number` (UPSERT semantics) so it's safe to re-run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, providerLabel, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import {
  PLAYBOOK_DEFAULTS,
  resolvePlaybook,
  renderEnvelopeDesignTemplate,
} from "../_shared/assistant-playbook.ts";
import { resolveSystemPrompt, applyUserHeader } from "../_shared/system-prompts.ts";

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
  "openai-5.4": "openai/gpt-5.4",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, modelOverride } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: project, error: pErr } = await supa
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    if (pErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Owner playbook (envelopes config + design template)
    const { data: profile } = await supa
      .from("profiles")
      .select("assistant_playbook")
      .eq("id", project.owner_id)
      .maybeSingle();
    const playbook = resolvePlaybook((profile as { assistant_playbook?: unknown } | null)?.assistant_playbook);

    const { data: existing } = await supa
      .from("envelopes")
      .select("id, number")
      .eq("project_id", projectId);
    const existingByNumber = new Map<number, string>(
      (existing ?? []).map((e) => [e.number as number, e.id as string]),
    );

    const { data: suspects } = await supa
      .from("suspects")
      .select("name, role_in_case, is_red_herring")
      .eq("project_id", projectId)
      .order("position");
    const { data: docs } = await supa
      .from("documents")
      .select("doc_number, title, doc_type")
      .eq("project_id", projectId)
      .order("doc_number");
    const { data: logicNodes } = await supa
      .from("canvas_nodes")
      .select("id, title, node_type, description")
      .eq("project_id", projectId)
      .eq("board", "logic")
      .order("created_at", { ascending: true });

    const modelKey = (modelOverride as string) || (project.ai_provider_planning as string) || "lovable";
    const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL.lovable;
    const gameLanguage = String(project.game_language ?? "Hebrew").trim() || "Hebrew";
    const isRtl = ["Hebrew", "Arabic", "Persian", "Urdu", "Yiddish"].includes(gameLanguage);

    const labels = playbook.envelopes.labels;
    const count = playbook.envelopes.count;

    const sys = `You are a senior boxed-mystery game designer. You are designing the ${count} sealed TASK envelopes that gate key beats of the player flow for a ${gameLanguage} murder-mystery game. The output MUST be a single JSON tool call. No prose.

GAME-FLOW MODEL (read carefully):
- All evidence documents in this case are in the box from the very start. The player has access to every document immediately.
- Envelopes are NOT document containers. Each envelope is a SEALED TASK GATE — the player only opens it when they reach a specific beat in the case.
- Inside each envelope is a short task, a reveal, or an instruction — NEVER the next batch of evidence to read.

ENVELOPE FLOW RULES (workspace defaults — follow):
- There are exactly ${count} envelopes in this case, in order: ${labels.map((l, i) => `#${i} "${l}"`).join(", ")}.
- Envelope #0 ("${labels[0]}") is the MISSION BRIEFING — opened first, before anything else. It introduces the case, the player's role, and points the player at Doc 0 (the master inventory of all documents in the box). Its opening trigger is simply "Open first, before reading anything else."
- The FINAL envelope (#${count - 1}) contains the ACCUSATION FORM / SOLUTION REVEAL — opened only when the player is ready to commit to their answer. Its opening trigger is "Open only when you are ready to name the culprit."
- Each middle envelope (#1..#${count - 2}) is tied to a specific BEAT in the Logic Flow: a moment where the player has narrowed something down, decoded a specific clue, identified the murder weapon, ruled out a suspect, etc. Reason from the actual logic of THIS case — never from a fixed template.
- Tasks are SHORT, BOLD, in ${gameLanguage}, ${isRtl ? "RTL" : "LTR"}. Never spoiler-heavy. The closing line "${playbook.envelopes.closing_line_he}" is appended automatically by the UI when the language matches — do NOT include it in the task field.

${renderEnvelopeDesignTemplate(playbook)}

For each envelope you generate:
- "label": short ${gameLanguage} name shown on the envelope front. ${isRtl ? "RTL" : "LTR"}, grammatical.
- "task": short, bold ${gameLanguage} task / instruction / reveal the player reads when they open it at the right moment. 1–2 short sentences. Never reveal the solution. Never tell the player to "go open the next envelope to get more evidence" — the documents are already in the box.
- "opening_trigger": 1 short sentence in ${gameLanguage} describing the case beat that unlocks this envelope (e.g. "פתחו לאחר שצמצמתם את החשודים לשניים." / "Open after you have narrowed it down to two suspects."). For envelope #0 use "פתחו ראשונה." (or the equivalent in ${gameLanguage}). For the final envelope use a phrase meaning "Open only when ready to name the culprit."
- "design_instructions": a long structured visual brief for the image generator, customised from the workspace template above. Include the envelope's number, the ${gameLanguage} label verbatim, and at least one detail tied to this case (era, genre, setting). 8–20 lines.`;

    const userPrompt = `CASE CONTEXT
Title: ${project.title}
Game language: ${gameLanguage}
Subtitle: ${project.subtitle ?? "—"}
Year/Setting: ${project.year ?? "—"} · ${project.setting ?? "—"}
Genre: ${project.genre ?? "mystery"} · Type: ${project.mystery_type ?? "—"} · Difficulty: ${project.difficulty ?? "—"}
Player role: ${project.player_role ?? "—"}
Case goal: ${project.case_goal ?? "—"}
Selling point: ${project.selling_point ?? "—"}
Solution summary: ${project.solution_summary ?? "(not yet written)"}

SUSPECTS:
${(suspects ?? []).map((s, i) => `${i + 1}. ${s.name}${s.is_red_herring ? " (red herring)" : ""} — ${s.role_in_case ?? "—"}`).join("\n") || "(none yet)"}

LOGIC FLOW NODES (use these to choose the case beat each middle envelope is gated on):
${(logicNodes ?? []).slice(0, 40).map((n) => `- [${n.node_type}] ${n.title}${n.description ? ` — ${String(n.description).slice(0, 120)}` : ""}`).join("\n") || "(none yet)"}

DOCUMENTS in the box (${docs?.length ?? 0} total — all available to the player from the start; do NOT use these to fill envelopes):
${(docs ?? []).slice(0, 30).map((d) => `#${d.doc_number ?? "?"} ${d.title} (${d.doc_type ?? "—"})`).join("\n") || "(none yet)"}

Produce all ${count} envelopes now in numerical order. Reuse the labels above as the starting point for the "label" field but you may refine them. Each envelope must have a distinct opening_trigger anchored in this case's logic flow.`;

    const tool = {
      type: "function",
      function: {
        name: "emit_envelopes",
        description: `Return all ${count} envelopes in order.`,
        parameters: {
          type: "object",
          properties: {
            envelopes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  number: { type: "number", description: `0..${count - 1}` },
                  label: { type: "string" },
                  task: { type: "string" },
                  opening_trigger: { type: "string", description: "1-sentence description of when the player should open this envelope (in the game language)." },
                  design_instructions: { type: "string" },
                },
                required: ["number", "label", "task", "opening_trigger", "design_instructions"],
                additionalProperties: false,
              },
            },
          },
          required: ["envelopes"],
          additionalProperties: false,
        },
      },
    };

    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);
    const resp = await chatCompletions({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_envelopes" } },
    });
    const fb = extractFallback(resp, model);

    if (!resp.ok) {
      const provider = providerLabel(model);
      const t = await resp.text().catch(() => "");
      console.error(`generate-envelopes ${provider} error`, resp.status, t);
      await logAiRun({
        userId: callerUserId, projectId, surface: "generate-envelopes",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "error", latencyMs: Date.now() - startedAt,
        errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`, promptExcerpt: userPrompt,
      });
      if (resp.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) return new Response(JSON.stringify({ error: `${provider} credits/key issue. Check Settings → AI provider routing.` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 401) return new Response(JSON.stringify({ error: `${provider} auth failed — check the API key in Settings → API keys.` }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})${t ? ": " + t.slice(0, 200) : ""}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!call) {
      return new Response(JSON.stringify({ error: "No structured output returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const parsed = JSON.parse(call) as {
      envelopes: { number: number; label: string; task: string; opening_trigger?: string; design_instructions: string }[];
    };

    let written = 0;
    for (const env of parsed.envelopes) {
      const number = Math.max(0, Math.min(count - 1, Math.round(env.number)));
      const id = existingByNumber.get(number);
      const trigger = (env.opening_trigger ?? "").trim();
      const notes = trigger ? `Opening trigger: ${trigger}` : null;
      if (id) {
        await supa.from("envelopes").update({
          label: env.label,
          task: env.task,
          design_instructions: env.design_instructions,
          ...(notes ? { notes } : {}),
          status: "review",
        }).eq("id", id);
      } else {
        await supa.from("envelopes").insert({
          project_id: projectId,
          number,
          label: env.label,
          task: env.task,
          design_instructions: env.design_instructions,
          ...(notes ? { notes } : {}),
          status: "review",
        });
      }
      written += 1;
    }

    // Stamp assistant_origins.envelopes so the badge shows up.
    const origins = (project.assistant_origins ?? {}) as Record<string, string>;
    await supa.from("projects").update({
      assistant_origins: { ...origins, envelopes: "manual-generate" },
    }).eq("id", projectId);

    await supa.from("prompts").insert({
      project_id: projectId,
      scope: "envelopes-batch",
      original_prompt: userPrompt,
      final_prompt: userPrompt,
      provider: providerLabel(model),
      model,
    });

    await logAiRun({
      userId: callerUserId, projectId, surface: "generate-envelopes",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt: userPrompt,
    });
    return new Response(JSON.stringify({ ok: true, count: written, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-envelopes error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

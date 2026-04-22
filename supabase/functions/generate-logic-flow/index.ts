// Generate a proposed game-solving logic flow (clues, red herrings, suspects, summary)
// for a project. Writes nodes/edges into the "logic" board and the solution_summary on the project.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, providerLabel } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mirrors assistant-chat / generate-document — see _shared/ai-router.ts for prefix routing.
//   openai/*        → user's OpenAi key
//   anthropic/*     → user's ANTHROPIC_API_KEY
//   gemini-direct/* → user's GEMINI_API_KEY
//   google/* | else → Lovable AI Gateway
const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-3.1-pro-preview",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  "openai-nano": "openai/gpt-5-nano",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "claude-haiku": "anthropic/claude-haiku-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
};

const NODE_COLORS: Record<string, string> = {
  clue: "oklch(0.68 0.15 155)",
  red_herring: "oklch(0.78 0.16 75)",
  suspect: "oklch(0.62 0.2 30)",
  deduction: "oklch(0.65 0.18 285)",
  solution: "oklch(0.45 0.15 285)",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, replace = true, modelOverride, useExistingSummary } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: project, error: pErr } = await supa.from("projects").select("*").eq("id", projectId).single();
    if (pErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: suspects } = await supa.from("suspects").select("*").eq("project_id", projectId).order("position", { ascending: true });

    const modelKey = (modelOverride as string) || (project.ai_provider_planning as string) || "lovable";
    const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL.lovable;

    // Default: if a solution_summary exists and the caller didn't explicitly pass false,
    // treat it as the source of truth.
    const approvedSummary = (project.solution_summary ?? "").trim();
    const useApproved = useExistingSummary === undefined ? !!approvedSummary : (useExistingSummary && !!approvedSummary);

    const sys = useApproved
      ? `You are a senior mystery game designer. The user has ALREADY APPROVED the case's solution narrative — your job is to break that exact narrative into a printable case logic flow (clues, deductions, red herrings, edges). DO NOT invent a different culprit, motive, weapon, or chain of events. Every node and edge must directly support or mislead from the approved narrative. The output must be a single JSON tool call. No prose. Hebrew is allowed for short labels but English keys.`
      : `You are a senior mystery game designer. Produce a tight, solvable case logic flow for a printable detective game. The output must be a single JSON tool call. No prose. Hebrew is allowed for short labels but English keys.`;

    const approvedBlock = useApproved
      ? `\nAPPROVED SOLUTION (source of truth — your flow MUST match this exactly):\n"""\n${approvedSummary}\n"""\n\nYour job is NOT to write a new solution. Your job is to decompose the approved solution above into the nodes/edges below. The "summary" field you return should restate the approved solution faithfully (you may tighten wording but must not change facts, culprit, motive, or method).\n`
      : "";

    const userPrompt = `CASE DESIGN BRIEF
Title: ${project.title}
Subtitle: ${project.subtitle ?? ""}
Year/Setting: ${project.year ?? "—"} · ${project.setting ?? "—"}
Genre: ${project.genre ?? "mystery"} · Type: ${project.mystery_type ?? "—"} · Difficulty: ${project.difficulty ?? "—"}
Player role: ${project.player_role ?? "—"}
Case goal: ${project.case_goal ?? "—"}
Selling point: ${project.selling_point ?? "—"}
${approvedBlock}
KNOWN SUSPECTS:
${(suspects ?? []).map((s, i) => `${i + 1}. ${s.name}${s.is_red_herring ? " (red herring)" : ""} — role: ${s.role_in_case ?? "—"} — motive: ${s.motives ?? "—"}`).join("\n") || "(none yet — invent 3-5 plausible ones)"}

PRODUCE a logic flow with:
- 6-10 CLUES the player must find/connect to solve the case (mix physical, testimonial, deductive).
- 2-4 RED HERRINGS that look meaningful but don't lead to the truth — explain briefly why each is misleading.
- 1-3 KEY DEDUCTIONS the player makes by combining clues.
- 1 FINAL SOLUTION node identifying the culprit and method.
- EDGES connecting clues → deductions → solution, and red_herring → suspect (false trail).
- A SOLUTION SUMMARY (3-5 short paragraphs in Hebrew if the game is Hebrew, otherwise English) explaining EXACTLY how the case is solved end-to-end.

Use stable string ids like "clue_1", "rh_1", "ded_1", "sus_1", "sol_1".
Position nodes in a left-to-right flow: clues on the left, deductions middle, solution right, red herrings + suspects below.`;

    const tool = {
      type: "function",
      function: {
        name: "emit_logic_flow",
        description: "Return the case logic flow",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "3-5 short paragraphs explaining how the case is solved" },
            nodes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string", enum: ["clue", "red_herring", "deduction", "suspect", "solution"] },
                  title: { type: "string" },
                  description: { type: "string" },
                  x: { type: "number" },
                  y: { type: "number" },
                },
                required: ["id", "type", "title", "x", "y"],
                additionalProperties: false,
              },
            },
            edges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  source: { type: "string" },
                  target: { type: "string" },
                  label: { type: "string" },
                },
                required: ["source", "target"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "nodes", "edges"],
          additionalProperties: false,
        },
      },
    };

    const resp = await chatCompletions({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_logic_flow" } },
    });

    if (!resp.ok) {
      const provider = model.startsWith("openai/") ? "OpenAI"
        : model.startsWith("anthropic/") ? "Anthropic"
        : model.startsWith("gemini-direct/") ? "Google Gemini"
        : "Lovable AI";
      const t = await resp.text().catch(() => "");
      console.error(`logic-flow ${provider} error`, resp.status, t);
      if (resp.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) {
        const hint = provider === "Lovable AI"
          ? "Add credits in Settings → Workspace → Usage, or switch this project's planning provider in Settings → AI provider routing."
          : `Check your ${provider} account billing.`;
        return new Response(JSON.stringify({ error: `${provider} credits/key issue. ${hint}` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resp.status === 401) return new Response(JSON.stringify({ error: `${provider} authentication failed — check the API key in Settings → API keys.` }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})${t ? ": " + t.slice(0, 200) : ""}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!call) {
      return new Response(JSON.stringify({ error: "No structured output returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const parsed = JSON.parse(call) as {
      summary: string;
      nodes: { id: string; type: string; title: string; description?: string; x: number; y: number }[];
      edges: { source: string; target: string; label?: string }[];
    };

    if (replace) {
      await supa.from("canvas_edges").delete().eq("project_id", projectId).eq("board", "logic");
      await supa.from("canvas_nodes").delete().eq("project_id", projectId).eq("board", "logic");
    }

    const idMap = new Map<string, string>();
    const nodeRows = parsed.nodes.map((n) => ({
      project_id: projectId,
      board: "logic",
      node_type: n.type,
      title: n.title.slice(0, 200),
      description: n.description ?? null,
      color: NODE_COLORS[n.type] ?? null,
      position_x: n.x,
      position_y: n.y,
    }));
    const { data: insertedNodes, error: nErr } = await supa.from("canvas_nodes").insert(nodeRows).select();
    if (nErr) {
      console.error("node insert", nErr);
      return new Response(JSON.stringify({ error: nErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    insertedNodes?.forEach((row, i) => idMap.set(parsed.nodes[i].id, row.id));

    const edgeRows = parsed.edges
      .map((e) => {
        const s = idMap.get(e.source);
        const t = idMap.get(e.target);
        if (!s || !t) return null;
        return { project_id: projectId, board: "logic", source_id: s, target_id: t, label: e.label ?? null };
      })
      .filter(Boolean) as { project_id: string; board: string; source_id: string; target_id: string; label: string | null }[];
    if (edgeRows.length) {
      const { error: eErr } = await supa.from("canvas_edges").insert(edgeRows);
      if (eErr) console.error("edge insert", eErr);
    }

    // Only overwrite the canonical solution_summary when the caller explicitly
    // asked for a fresh case. When using the approved summary, preserve the
    // assistant-approved text exactly.
    if (!useApproved) {
      await supa.from("projects").update({ solution_summary: parsed.summary }).eq("id", projectId);
    }

    await supa.from("prompts").insert({
      project_id: projectId,
      scope: "logic-flow",
      original_prompt: userPrompt,
      final_prompt: userPrompt,
      provider: providerLabel(model),
      model,
    });

    return new Response(JSON.stringify({
      ok: true,
      summary: useApproved ? approvedSummary : parsed.summary,
      usedApprovedSummary: useApproved,
      nodeCount: parsed.nodes.length,
      edgeCount: edgeRows.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-logic-flow error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Generate a proposed game-solving logic flow (clues, red herrings, suspects, summary)
// for a project. Writes nodes/edges into the "logic" board and the solution_summary on the project.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, providerLabel, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { claudeSkillPromptBlock, loadClaudeSkillsForSurface, withClaudeSkills } from "../_shared/claude-skills.ts";

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
  "openai-nano": "openai/gpt-5-nano",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "claude-haiku": "anthropic/claude-haiku-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

const NODE_COLORS: Record<string, string> = {
  clue: "oklch(0.68 0.15 155)",
  red_herring: "oklch(0.78 0.16 75)",
  suspect: "oklch(0.62 0.2 30)",
  deduction: "oklch(0.65 0.18 285)",
  solution: "oklch(0.45 0.15 285)",
  envelope: "oklch(0.55 0.18 220)",
  hint: "oklch(0.78 0.16 75)",
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
    const { data: existingEnvelopes } = await supa.from("envelopes").select("id, number, label, task, design_instructions, linked_document_ids").eq("project_id", projectId).order("number", { ascending: true });

    // If no envelopes exist yet, ask the model to scaffold them. Derive a sensible
    // default count from target_doc_count (≈ one envelope per 7 docs, clamped 4-7).
    const noEnvelopes = !existingEnvelopes || existingEnvelopes.length === 0;
    const targetDocs = Number(project.target_doc_count ?? 40);
    const scaffoldCount = noEnvelopes
      ? Math.max(4, Math.min(7, Math.round(targetDocs / 7)))
      : 0;

    const modelKey = (modelOverride as string) || (project.ai_provider_planning as string) || "lovable";
    const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL.lovable;
    const gameLanguage = String(project.game_language ?? "Hebrew").trim() || "Hebrew";
    const enabledSkills = model.startsWith("anthropic/") ? await loadClaudeSkillsForSurface(supa, "analysis") : [];

    const approvedSummary = (project.solution_summary ?? "").trim();
    const useApproved = useExistingSummary === undefined ? !!approvedSummary : (useExistingSummary && !!approvedSummary);

    const sys = useApproved
      ? `You are a senior mystery game designer. The user has ALREADY APPROVED the case's solution narrative — your job is to break that exact narrative into a printable case logic flow (clues, deductions, red herrings, edges). DO NOT invent a different culprit, motive, weapon, or chain of events. Every node and edge must directly support or mislead from the approved narrative. The output must be a single JSON tool call. No prose. ${gameLanguage} is allowed for short labels but English keys.\n\n${claudeSkillPromptBlock(enabledSkills, "analysis")}`
      : `You are a senior mystery game designer. Produce a tight, solvable case logic flow for a printable detective game. The output must be a single JSON tool call. No prose. ${gameLanguage} is allowed for short labels but English keys.\n\n${claudeSkillPromptBlock(enabledSkills, "analysis")}`;

    const approvedBlock = useApproved
      ? `\nAPPROVED SOLUTION (source of truth — your flow MUST match this exactly):\n"""\n${approvedSummary}\n"""\n\nYour job is NOT to write a new solution. Your job is to decompose the approved solution above into the nodes/edges below. The "summary" field you return should restate the approved solution faithfully (you may tighten wording but must not change facts, culprit, motive, or method).\n`
      : "";

    const envelopesBlock = !noEnvelopes
      ? `\nENVELOPES (player-facing flow gates — each MUST become an "envelope" node, in numerical order, in a vertical lane on the right side of the canvas):\n${existingEnvelopes!.map((e) => `  #${e.number} "${e.label ?? ""}" — task: ${e.task ?? "—"}`).join("\n")}\n\nFor each envelope, draw edges showing which clues / deductions belong inside it (clue → envelope, deduction → envelope). Also draw chain edges envelope_n → envelope_{n+1} so the player flow is visible.\n\nFor EVERY envelope node, the "description" field is REQUIRED and MUST contain exactly three lines, in this format:\nTask: <what the player physically does with this envelope — open, scan QR, assemble, etc.>\nContains: <one-line summary of which clues/deductions sit inside it>\nWhy it matters: <one sentence on how it advances the case structure / what it unlocks for the next envelope>\n`
      : `\nENVELOPES — this project has no envelopes yet. You MUST scaffold ${scaffoldCount} envelopes that segment the case into a clear player flow.\n\nReturn them in BOTH the top-level "envelopes" array (number, label, task, design_instructions) AND as "envelope" nodes on the canvas (one node per envelope, numbered 1..${scaffoldCount}, in a vertical lane on the right at x ≈ 1400 with y stepping down by 160 starting at y = 0). The first envelope is the case opener, the last contains/locks the final reveal.\n\nFor EVERY envelope node, the "description" field is REQUIRED and MUST contain exactly three lines, in this format:\nTask: <what the player physically does with this envelope — open, scan QR, assemble, etc.>\nContains: <one-line summary of which clues/deductions sit inside it>\nWhy it matters: <one sentence on how it advances the case structure / what it unlocks for the next envelope>\n\nAlso draw envelope_n → envelope_{n+1} chain edges, and clue/deduction → envelope edges showing which evidence sits in which envelope.\n`;

    const userPrompt = `CASE DESIGN BRIEF
Title: ${project.title}
Game language: ${gameLanguage}
Subtitle: ${project.subtitle ?? ""}
Year/Setting: ${project.year ?? "—"} · ${project.setting ?? "—"}
Genre: ${project.genre ?? "mystery"} · Type: ${project.mystery_type ?? "—"} · Difficulty: ${project.difficulty ?? "—"}
Player role: ${project.player_role ?? "—"}
Case goal: ${project.case_goal ?? "—"}
Selling point: ${project.selling_point ?? "—"}
${approvedBlock}
KNOWN SUSPECTS:
${(suspects ?? []).map((s, i) => `${i + 1}. ${s.name}${s.is_red_herring ? " (red herring)" : ""} — role: ${s.role_in_case ?? "—"} — motive: ${s.motives ?? "—"}`).join("\n") || "(none yet — invent 3-5 plausible ones)"}
${envelopesBlock}
PRODUCE a logic flow with:
- 6-10 CLUES the player must find/connect to solve the case (mix physical, testimonial, deductive).
- 2-4 RED HERRINGS that look meaningful but don't lead to the truth — explain briefly why each is misleading.
- 1-3 KEY DEDUCTIONS the player makes by combining clues.
- 1 FINAL SOLUTION node identifying the culprit and method.
- ${noEnvelopes ? scaffoldCount : existingEnvelopes!.length} ENVELOPE nodes (one per envelope above), positioned in a vertical lane on the right (x ≈ 1400, y stepping down by 160 per envelope, ordered by number).
- 3-5 HINT nodes (one per clue/deduction that warrants a hint stage), titled "Hint stage N — for: <clue/deduction title>". Position them in a vertical lane to the LEFT of clues at x ≈ -200, with y matching the clue/deduction they support. These are STRUCTURAL placeholders only — the user will fill in the actual hint text later. Do NOT write final hint text into the description; a one-line English note about WHAT this stage hints toward is enough.
- EDGES connecting clues → deductions → solution, red_herring → suspect (false trail), hint → clue/deduction (label "hints toward"), clue/deduction → envelope (which envelope holds which evidence), and envelope_n → envelope_{n+1} (player chain).
- A SOLUTION SUMMARY (3-5 short paragraphs in ${gameLanguage}) explaining EXACTLY how the case is solved end-to-end.

Use stable string ids like "clue_1", "rh_1", "ded_1", "sus_1", "sol_1", "hint_1", …, "env_1", "env_2", … (one per envelope, numbered from 1).
Position nodes in a left-to-right flow: hints far left (x ≈ -200), clues left (x ≈ 0-300), deductions middle, solution right, envelopes far right (x ≈ 1400), red herrings + suspects below.

For envelope nodes specifically, set the node "id" to "env_<number>" matching its envelope number (env_1, env_2, …) so they can be cross-referenced.`;

    const tool = {
      type: "function",
      function: {
        name: "emit_logic_flow",
        description: "Return the case logic flow",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "3-5 short paragraphs explaining how the case is solved" },
            envelopes: {
              type: "array",
              description: noEnvelopes
                ? `REQUIRED: scaffold exactly ${scaffoldCount} envelopes for this case.`
                : "Optional — leave empty when envelopes already exist on the project.",
              items: {
                type: "object",
                properties: {
                  number: { type: "integer", description: "1-indexed envelope number" },
                  label: { type: "string", description: "Short envelope name (e.g. 'Crime scene packet')" },
                  task: { type: "string", description: "What the player does with this envelope" },
                  design_instructions: { type: "string", description: "Brief art-direction note for the envelope cover" },
                },
                required: ["number", "label", "task"],
                additionalProperties: false,
              },
            },
            nodes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string", enum: ["clue", "red_herring", "deduction", "suspect", "solution", "envelope", "hint"] },
                  title: { type: "string" },
                  description: { type: "string" },
                  envelope_number: { type: "integer", description: "REQUIRED for envelope nodes — must match the envelope's number" },
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

    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);
    const resp = await chatCompletions(withClaudeSkills({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_logic_flow" } },
    }, enabledSkills));
    const fb = extractFallback(resp, model);

    if (!resp.ok) {
      const provider = model.startsWith("openai/") ? "OpenAI"
        : model.startsWith("anthropic/") ? "Anthropic"
        : model.startsWith("gemini-direct/") ? "Google Gemini"
        : "Lovable AI";
      const t = await resp.text().catch(() => "");
      console.error(`logic-flow ${provider} error`, resp.status, t);
      await logAiRun({
        userId: callerUserId, projectId, surface: "generate-logic-flow",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "error", latencyMs: Date.now() - startedAt,
        errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`, promptExcerpt: userPrompt,
      });
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
      envelopes?: { number: number; label: string; task: string; design_instructions?: string }[];
      nodes: { id: string; type: string; title: string; description?: string; envelope_number?: number; x: number; y: number }[];
      edges: { source: string; target: string; label?: string }[];
    };

    if (replace) {
      await supa.from("canvas_edges").delete().eq("project_id", projectId).eq("board", "logic");
      await supa.from("canvas_nodes").delete().eq("project_id", projectId).eq("board", "logic");
    }

    // If envelopes were scaffolded, insert them BEFORE nodes so we can link them.
    let envelopesForLinking = existingEnvelopes ?? [];
    if (noEnvelopes && parsed.envelopes && parsed.envelopes.length > 0) {
      const envRows = parsed.envelopes
        .sort((a, b) => a.number - b.number)
        .map((e) => ({
          project_id: projectId,
          number: e.number,
          label: e.label ?? null,
          task: e.task ?? null,
          design_instructions: e.design_instructions ?? null,
          status: "draft",
        }));
      const { data: insertedEnvs, error: envErr } = await supa.from("envelopes").insert(envRows).select("id, number, label, task, design_instructions, linked_node_ids");
      if (envErr) {
        console.error("envelope scaffold insert", envErr);
      } else if (insertedEnvs) {
        envelopesForLinking = insertedEnvs.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
      }
    }

    const idMap = new Map<string, string>();
    const nodeRows = parsed.nodes.map((n) => {
      const data: Record<string, unknown> = {};
      if (n.type === "envelope" && typeof n.envelope_number === "number") {
        data.envelopeNumber = n.envelope_number;
      }
      return {
        project_id: projectId,
        board: "logic",
        node_type: n.type,
        title: n.title.slice(0, 200),
        description: n.description ?? null,
        color: NODE_COLORS[n.type] ?? null,
        position_x: n.x,
        position_y: n.y,
        data,
      };
    });
    const { data: insertedNodes, error: nErr } = await supa.from("canvas_nodes").insert(nodeRows).select();
    if (nErr) {
      console.error("node insert", nErr);
      return new Response(JSON.stringify({ error: nErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    insertedNodes?.forEach((row, i) => idMap.set(parsed.nodes[i].id, row.id));

    // Cross-link envelope nodes ↔ envelope rows by matching envelope_number
    // (falling back to order-of-appearance for older clients that don't emit it).
    if (envelopesForLinking.length > 0 && insertedNodes) {
      const envNodes = parsed.nodes
        .map((n, i) => ({ n, rowId: insertedNodes[i]?.id }))
        .filter((x) => x.n.type === "envelope" && x.rowId);

      for (let i = 0; i < envNodes.length; i += 1) {
        const { n, rowId } = envNodes[i];
        // Match by envelope_number first, then fall back to ordinal
        const env = (typeof n.envelope_number === "number"
          ? envelopesForLinking.find((e) => e.number === n.envelope_number)
          : null) ?? envelopesForLinking[i];
        if (!env || !rowId) continue;
        const existing = (env.linked_node_ids ?? []) as string[];
        const next = Array.from(new Set([...existing, rowId]));
        await supa.from("envelopes").update({ linked_node_ids: next }).eq("id", env.id);
      }
    }

    // For every emitted hint node, scaffold an empty 3-rung row set in the
    // `hints` table so the Hints tab is pre-populated.
    if (insertedNodes) {
      const hintNodes = parsed.nodes.filter((n) => n.type === "hint");
      if (hintNodes.length > 0) {
        const { data: existingHints } = await supa
          .from("hints").select("stage").eq("project_id", projectId);
        const maxStage = (existingHints ?? []).reduce(
          (acc, r) => Math.max(acc, Number((r as { stage?: number }).stage ?? 0)), 0,
        );
        const hintRows: { project_id: string; stage: number; level: number; text: string }[] = [];
        hintNodes.forEach((_, i) => {
          const stage = maxStage + i + 1;
          for (let level = 1; level <= 3; level += 1) {
            hintRows.push({ project_id: projectId, stage, level, text: "" });
          }
        });
        if (hintRows.length > 0) {
          const { error: hErr } = await supa.from("hints").insert(hintRows);
          if (hErr) console.error("hint scaffold insert", hErr);
        }
      }
    }

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

    await logAiRun({
      userId: callerUserId, projectId, surface: "generate-logic-flow",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt: userPrompt,
    });
    return new Response(JSON.stringify({
      ok: true,
      summary: useApproved ? approvedSummary : parsed.summary,
      usedApprovedSummary: useApproved,
      nodeCount: parsed.nodes.length,
      edgeCount: edgeRows.length,
      scaffoldedEnvelopes: noEnvelopes ? (parsed.envelopes?.length ?? 0) : 0,
      model,
      effectiveModel: fb.effectiveModel,
      fallback: fb.fallback,
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

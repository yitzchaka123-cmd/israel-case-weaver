// Generate a concise AI explanation for a single canvas node:
// what role it plays in the case, how it connects to other nodes,
// and how it relates to the overall solution.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Match generate-logic-flow's mapping so users get the same model
// they picked for planning.
const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-3.1-pro-preview",
  gemini: "google/gemini-2.5-pro",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  "openai-nano": "openai/gpt-5-nano",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { nodeId, modelOverride } = await req.json();
    if (!nodeId) {
      return new Response(JSON.stringify({ error: "nodeId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);

    // Pull the node and its project
    const { data: node, error: nErr } = await supa
      .from("canvas_nodes")
      .select("*")
      .eq("id", nodeId)
      .single();
    if (nErr || !node) {
      return new Response(JSON.stringify({ error: "Node not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project } = await supa
      .from("projects")
      .select("title, subtitle, year, setting, genre, mystery_type, player_role, case_goal, solution_summary, ai_provider_planning")
      .eq("id", node.project_id)
      .single();

    // Pull connected edges + sibling nodes for context
    const { data: edges } = await supa
      .from("canvas_edges")
      .select("source_id, target_id, label")
      .eq("project_id", node.project_id)
      .eq("board", node.board);

    const neighborIds = new Set<string>();
    (edges ?? []).forEach((e) => {
      if (e.source_id === nodeId) neighborIds.add(e.target_id);
      if (e.target_id === nodeId) neighborIds.add(e.source_id);
    });

    let neighbors: Array<{ id: string; title: string; node_type: string }> = [];
    if (neighborIds.size) {
      const { data: nb } = await supa
        .from("canvas_nodes")
        .select("id, title, node_type")
        .in("id", [...neighborIds]);
      neighbors = nb ?? [];
    }

    // Pull any documents linked to this node
    const { data: linkedDocs } = await supa
      .from("documents")
      .select("id, title, doc_number, doc_type")
      .eq("project_id", node.project_id)
      .contains("linked_node_ids", [nodeId]);

    const modelKey = (modelOverride as string) || (project?.ai_provider_planning as string) || "openai-5.2";
    const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL["openai-5.2"];

    const sys = `You are a senior mystery game designer explaining a single node in a case logic flow to the game's author. Be concrete, brief (3-5 short paragraphs max), and reference how this node connects to the wider solution. No fluff, no bullet lists unless genuinely needed.`;

    const userPrompt = `CASE:
Title: ${project?.title ?? "—"}${project?.subtitle ? ` · ${project.subtitle}` : ""}
Setting: ${project?.year ?? "—"} · ${project?.setting ?? "—"} · ${project?.genre ?? "—"}
Player role: ${project?.player_role ?? "—"}
Case goal: ${project?.case_goal ?? "—"}

OVERALL SOLUTION SUMMARY (the source of truth):
${project?.solution_summary ?? "(none yet)"}

THIS NODE:
Type: ${node.node_type}
Title: ${node.title}
Description: ${node.description ?? "(none)"}

CONNECTED TO ${neighbors.length} OTHER NODE(S):
${neighbors.map((n) => `- ${n.title} (${n.node_type})`).join("\n") || "(none)"}

LINKED DOCUMENTS (${linkedDocs?.length ?? 0}):
${(linkedDocs ?? []).map((d) => `- #${d.doc_number ?? "?"} ${d.title}${d.doc_type ? ` (${d.doc_type})` : ""}`).join("\n") || "(none)"}

EXPLAIN, for the author:
1. What role this node plays in the case (1 short paragraph).
2. How it connects to its neighbors and the overall solution (1 short paragraph).
3. If it's a clue or red herring: how the player is meant to encounter and interpret it (1 short paragraph).
4. Any concrete suggestion to strengthen this node (1 short paragraph, optional).`;

    const resp = await chatCompletions({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("explain-canvas-node error", resp.status, t);
      return new Response(JSON.stringify({ error: `AI error (${resp.status})` }), {
        status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? "(no response)";

    return new Response(
      JSON.stringify({
        ok: true,
        explanation: text,
        node: { id: node.id, title: node.title, node_type: node.node_type, description: node.description },
        neighbors,
        linkedDocuments: linkedDocs ?? [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("explain-canvas-node fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

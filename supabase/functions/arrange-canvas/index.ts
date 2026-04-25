// AI-driven smart layout for the case-board canvas.
//
// Reads all nodes + edges for a given (project, board), sends a compact summary
// to an LLM, and asks it (via tool calling) to return absolute (x, y) positions
// for every node so the resulting board reads as a clear "story" of the game,
// edge labels remain readable, and connected items are aligned.
//
// Falls back to a deterministic lane-based layout if the model misbehaves.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Match generate-logic-flow / explain-canvas-node so the same Logic Flow model
// pick is reused.
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
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

// Visual constants — match what the deterministic layout uses on the client so
// the AI returns coordinates in the same coordinate system.
const NODE_W = 240;
const NODE_H = 130;
const COL_GAP = 140;   // wider than before so edge labels have room
const ROW_GAP = 140;   // wider than before so edge labels have room
const STEP_X = NODE_W + COL_GAP; // 380
const STEP_Y = NODE_H + ROW_GAP; // 270

type ArrangeNode = {
  id: string;
  title: string;
  node_type: string;
  description: string | null;
  data: Record<string, unknown> | null;
};
type ArrangeEdge = { id: string; source_id: string; target_id: string; label: string | null };

// Deterministic lane-based fallback that mirrors the client's old logic, but
// with the wider spacing so edge labels stay legible.
function fallbackLayout(nodes: ArrangeNode[], edges: ArrangeEdge[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const LANES: { key: string; types: string[] }[] = [
    { key: "suspects", types: ["suspect"] },
    { key: "clues", types: ["clue"] },
    { key: "envelopes", types: ["envelope"] },
    { key: "documents", types: ["document"] },
    { key: "reasoning", types: ["deduction", "contradiction"] },
    { key: "distractions", types: ["red_herring", "hint", "note"] },
    { key: "solution", types: ["solution"] },
  ];
  const dataOf = (id: string) =>
    (nodes.find((n) => n.id === id)?.data ?? {}) as { envelopeNumber?: number; docNumber?: number; type?: string };

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source_id)) outgoing.set(e.source_id, []);
    outgoing.get(e.source_id)!.push(e.target_id);
    if (!incoming.has(e.target_id)) incoming.set(e.target_id, []);
    incoming.get(e.target_id)!.push(e.source_id);
  }

  const envelopeNodes = nodes
    .filter((n) => n.node_type === "envelope")
    .sort((a, b) => (dataOf(a.id).envelopeNumber ?? 9999) - (dataOf(b.id).envelopeNumber ?? 9999));
  const envCol = new Map<string, number>();
  const envY = LANES.findIndex((l) => l.key === "envelopes") * STEP_Y + 80;
  envelopeNodes.forEach((n, i) => {
    envCol.set(n.id, i);
    positions[n.id] = { x: 80 + i * STEP_X, y: envY };
  });

  const docNodes = nodes
    .filter((n) => n.node_type === "document")
    .sort((a, b) => {
      const ae = dataOf(a.id).envelopeNumber ?? 9999;
      const be = dataOf(b.id).envelopeNumber ?? 9999;
      if (ae !== be) return ae - be;
      return (dataOf(a.id).docNumber ?? 9999) - (dataOf(b.id).docNumber ?? 9999);
    });
  const docY = LANES.findIndex((l) => l.key === "documents") * STEP_Y + 80;
  const docStack = new Map<number, number>();
  let fallbackCol = 0;
  for (const d of docNodes) {
    let col: number | undefined;
    for (const id of [...(incoming.get(d.id) ?? []), ...(outgoing.get(d.id) ?? [])]) {
      const c = envCol.get(id);
      if (c !== undefined) { col = c; break; }
    }
    if (col === undefined && dataOf(d.id).envelopeNumber !== undefined) {
      const env = envelopeNodes.find((e) => dataOf(e.id).envelopeNumber === dataOf(d.id).envelopeNumber);
      if (env) col = envCol.get(env.id);
    }
    const c = col ?? envelopeNodes.length + fallbackCol++;
    const stack = docStack.get(c) ?? 0;
    docStack.set(c, stack + 1);
    positions[d.id] = { x: 80 + c * STEP_X, y: docY + stack * STEP_Y };
  }
  const extraDocRows = Math.max(0, Math.max(1, ...Array.from(docStack.values(), (v) => v)) - 1);

  const columnHint = (id: string): number => {
    for (const o of [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])]) {
      const c = envCol.get(o);
      if (c !== undefined) return c;
      const p = positions[o];
      if (p) return Math.round((p.x - 80) / STEP_X);
    }
    return Number.POSITIVE_INFINITY;
  };

  const docLaneIdx = LANES.findIndex((l) => l.key === "documents");
  LANES.forEach((lane, laneIdx) => {
    if (lane.key === "envelopes" || lane.key === "documents") return;
    const laneNodes = nodes
      .filter((n) => lane.types.includes(n.node_type))
      .sort((a, b) => columnHint(a.id) - columnHint(b.id));
    const effIdx = laneIdx > docLaneIdx ? laneIdx + extraDocRows : laneIdx;
    const y = effIdx * STEP_Y + 80;
    laneNodes.forEach((n, i) => {
      const hint = columnHint(n.id);
      let col = Number.isFinite(hint) ? (hint as number) : i;
      while (Object.values(positions).some((p) => p.y === y && Math.round((p.x - 80) / STEP_X) === col)) col++;
      positions[n.id] = { x: 80 + col * STEP_X, y };
    });
  });

  // Catch-all
  const trailingY = (LANES.length + extraDocRows) * STEP_Y + 80;
  let trailingCol = 0;
  for (const n of nodes) {
    if (!positions[n.id]) {
      positions[n.id] = { x: 80 + trailingCol++ * STEP_X, y: trailingY };
    }
  }
  return positions;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, board = "logic", modelOverride } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SERVICE);

    const [{ data: project }, { data: dbNodes }, { data: dbEdges }] = await Promise.all([
      supa.from("projects").select("title, subtitle, solution_summary, ai_provider_planning").eq("id", projectId).single(),
      supa.from("canvas_nodes").select("id, title, node_type, description, data, position_x, position_y")
        .eq("project_id", projectId).eq("board", board),
      supa.from("canvas_edges").select("id, source_id, target_id, label")
        .eq("project_id", projectId).eq("board", board),
    ]);

    const nodes = (dbNodes ?? []) as (ArrangeNode & { position_x: number; position_y: number })[];
    const edges = (dbEdges ?? []) as ArrangeEdge[];

    if (nodes.length === 0) {
      return new Response(JSON.stringify({ ok: true, positions: {}, count: 0, source: "noop" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const modelKey = (modelOverride as string) || (project?.ai_provider_planning as string) || "openai-5.2";
    const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL["openai-5.2"];

    // Compact view we hand to the model (keep tokens low).
    const compactNodes = nodes.map((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      return {
        id: n.id,
        type: n.node_type,
        title: (n.title || "").slice(0, 80),
        envelopeNumber: typeof d.envelopeNumber === "number" ? d.envelopeNumber : undefined,
        docNumber: typeof d.docNumber === "number" ? d.docNumber : undefined,
      };
    });
    const compactEdges = edges.map((e) => ({
      from: e.source_id, to: e.target_id, label: (e.label ?? "").slice(0, 40),
    }));

    const sys = `You are a layout engine for a mystery-game case board. You will receive a list of nodes and labelled edges. Return absolute (x, y) coordinates so the diagram reads as a clear left-to-right, top-to-bottom STORY of how the game plays out.

CRITICAL constraints:
1. Use a coordinate system where the top-left of the canvas is (0, 0). Each node is ${NODE_W}px wide and ${NODE_H}px tall.
2. Place nodes on a grid. Use horizontal step ≈ ${STEP_X}px between columns, and vertical step ≈ ${STEP_Y}px between rows. Never let two nodes overlap (centers must be at least ${NODE_W + 40}px apart horizontally OR ${NODE_H + 60}px apart vertically).
3. Group nodes into HORIZONTAL LANES by their semantic role, top to bottom in this order:
   Lane 0 (y≈80):           suspects
   Lane 1 (y≈80+1·${STEP_Y}): clues
   Lane 2 (y≈80+2·${STEP_Y}): envelopes  ← the SPINE; sort left→right by envelopeNumber
   Lane 3 (y≈80+3·${STEP_Y}): documents  ← stack vertically UNDER the envelope they belong to
   Lane 4:                  deductions / contradictions
   Lane 5:                  red_herring / hint / note
   Lane 6 (bottom):         solution
4. ALIGN connected items: if a clue/deduction/document is connected to envelope #N, place it in that envelope's COLUMN (same x). This makes the connecting lines short, mostly vertical, and easy to read.
5. LEAVE ROOM FOR EDGE LABELS. The labels appear on the connecting lines. Vertical edges between lanes need at least ${ROW_GAP}px of clear space; horizontal edges in the same lane need at least ${COL_GAP}px. If an edge has a label, prefer routing that goes through empty space (do NOT place a third node directly between the two endpoints of a labelled edge).
6. Keep similar nodes evenly spaced — do not bunch everything in a corner. The whole layout should be roughly centered around x ∈ [80, 80 + numColumns · ${STEP_X}].
7. Return EVERY node id exactly once. Coordinates must be integers.

Think like a designer reading the case for the first time: setup at the top, evidence flowing down through the envelope spine, reasoning below, solution at the bottom.`;

    const userPrompt = `PROJECT: "${project?.title ?? ""}" — ${project?.subtitle ?? ""}
${project?.solution_summary ? `SOLUTION SUMMARY (helps you decide which clues belong to which envelope):\n${(project.solution_summary as string).slice(0, 800)}\n` : ""}
NODES (${compactNodes.length}):
${JSON.stringify(compactNodes)}

EDGES (${compactEdges.length}):
${JSON.stringify(compactEdges)}

Return positions for all ${compactNodes.length} nodes via the arrange_board tool.`;

    const tool = {
      type: "function",
      function: {
        name: "arrange_board",
        description: "Return integer (x, y) pixel positions for every node id.",
        parameters: {
          type: "object",
          properties: {
            positions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  x: { type: "integer" },
                  y: { type: "integer" },
                  lane: { type: "string", description: "Optional: which lane this node was placed in" },
                },
                required: ["id", "x", "y"],
                additionalProperties: false,
              },
            },
            notes: { type: "string", description: "Optional: one-line summary of layout decisions" },
          },
          required: ["positions"],
          additionalProperties: false,
        },
      },
    };

    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);

    let aiPositions: Record<string, { x: number; y: number }> | null = null;
    let usedFallback = false;
    let aiNotes: string | undefined;
    let effectiveModel = model;
    let fallbackTag = "none";

    try {
      const resp = await chatCompletions({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "arrange_board" } },
      });
      const fb = extractFallback(resp, model);
      effectiveModel = fb.effectiveModel;
      fallbackTag = fb.fallback;

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.error("[arrange-canvas] AI error", resp.status, t.slice(0, 300));
        usedFallback = true;
      } else {
        const data = await resp.json();
        const call = data.choices?.[0]?.message?.tool_calls?.[0];
        const argsRaw = call?.function?.arguments;
        if (!argsRaw) {
          console.warn("[arrange-canvas] no tool call returned, using fallback");
          usedFallback = true;
        } else {
          let args: { positions?: { id: string; x: number; y: number }[]; notes?: string };
          try {
            args = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
          } catch (err) {
            console.error("[arrange-canvas] failed to parse tool args", err);
            usedFallback = true;
            args = {};
          }
          aiNotes = args.notes;
          const pos: Record<string, { x: number; y: number }> = {};
          const nodeIds = new Set(nodes.map((n) => n.id));
          for (const p of args.positions ?? []) {
            if (!p || typeof p.id !== "string" || !nodeIds.has(p.id)) continue;
            const x = Math.round(Number(p.x));
            const y = Math.round(Number(p.y));
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            pos[p.id] = { x, y };
          }
          // Require coverage of at least 80% of nodes — otherwise fall back.
          if (Object.keys(pos).length < Math.ceil(nodes.length * 0.8)) {
            console.warn(`[arrange-canvas] AI returned ${Object.keys(pos).length}/${nodes.length} positions, using fallback`);
            usedFallback = true;
          } else {
            aiPositions = pos;
          }
        }
      }
    } catch (err) {
      console.error("[arrange-canvas] exception calling AI", err);
      usedFallback = true;
    }

    let positions: Record<string, { x: number; y: number }>;
    if (usedFallback || !aiPositions) {
      positions = fallbackLayout(nodes, edges);
    } else {
      positions = aiPositions;
      // Fill any nodes the model forgot, using fallback for those only.
      const missing = nodes.filter((n) => !positions[n.id]);
      if (missing.length > 0) {
        const fb = fallbackLayout(missing, edges);
        for (const id of Object.keys(fb)) positions[id] = fb[id];
      }
      // Resolve obvious overlaps: if two nodes share the exact same point,
      // bump the second one down by a row.
      const seen = new Map<string, string>();
      for (const id of Object.keys(positions)) {
        const key = `${positions[id].x}|${positions[id].y}`;
        if (seen.has(key)) {
          positions[id] = { x: positions[id].x, y: positions[id].y + STEP_Y };
        } else {
          seen.set(key, id);
        }
      }
    }

    // Persist all positions in parallel.
    const updates = await Promise.all(
      Object.entries(positions).map(([id, p]) =>
        supa.from("canvas_nodes").update({ position_x: p.x, position_y: p.y }).eq("id", id),
      ),
    );
    const failed = updates.filter((u) => u.error).length;

    await logAiRun({
      userId: callerUserId,
      projectId,
      surface: "arrange-canvas",
      requestedModel: model,
      effectiveModel,
      fallback: fallbackTag,
      status: failed > 0 ? "error" : "ok",
      latencyMs: Date.now() - startedAt,
      promptExcerpt: `${nodes.length} nodes, ${edges.length} edges, ${usedFallback ? "fallback" : "ai"}`,
      errorMessage: failed > 0 ? `${failed} position writes failed` : undefined,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        positions,
        count: Object.keys(positions).length,
        source: usedFallback ? "fallback" : "ai",
        notes: aiNotes,
        model,
        effectiveModel,
        fallback: fallbackTag,
        failedWrites: failed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[arrange-canvas] fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

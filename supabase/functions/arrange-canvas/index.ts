// Smart layout for the case-board canvas.
//
// IMPLEMENTATION NOTE — research-backed Sugiyama (layered) layout.
//
// We use the same algorithm family that powers ComfyUI's auto-layout
// extensions, n8n's auto-arrange, and dagre / Eclipse ELK:
//
//   1. LAYERING — assign each node a column index = longest path from any
//      source node. Roots on the left, leaves on the right; connected nodes
//      always sit one layer apart so edges read as one-step arrows.
//   2. CROSSING REDUCTION — within each layer, reorder nodes by the median
//      x-position of their parents (left-to-right barycenter sweep). This
//      drastically reduces edge crossings without solving NP-hard placement.
//   3. COORDINATE ASSIGNMENT — fixed-stride packer. Each node placed inside
//      a layer is shifted right (or down, in column mode) by NODE + GAP from
//      the previous one. Overlap is impossible by construction; we removed
//      the old O(N²) "nudge if collide" resolver that caused the canvas to
//      explode on dense graphs.
//   4. COMPONENT-AWARE — disconnected subgraphs are laid out independently
//      and stacked vertically with a clear gap, never squeezed into the same
//      band as the connected graph.
//
// Variants (each press cycles through them):
//   Logic board: lanes (horizontal, role-grouped) | columns (vertical) |
//                suspects (swimlanes per suspect) | compact (chain-packed)
//   Final board: bands (Logic | Documents | Envelopes columns) |
//                stacked (rows) | envelope (grouped by envelope)
//
// "Refine with AI" no longer rewrites coordinates (that exploded the canvas).
// It now asks the LLM ONLY for logical groupings (which nodes should sit
// next to each other) and re-runs the deterministic packer with those
// groupings as hints.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";

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
  "openai-nano": "openai/gpt-5-nano",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

// Visual constants — keep aligned with the client's NodeTypes spacing.
const NODE_W = 240;
const NODE_H = 130;
const COL_GAP = 120;
const ROW_GAP = 80;
const STEP_X = NODE_W + COL_GAP; // 360
const STEP_Y = NODE_H + ROW_GAP; // 210
const ORIGIN_X = 80;
const ORIGIN_Y = 80;
const COMPONENT_GAP_Y = 60; // extra space between disconnected components

type ArrangeNode = {
  id: string;
  title: string;
  node_type: string;
  description: string | null;
  data: Record<string, unknown> | null;
  position_x?: number;
  position_y?: number;
};
type ArrangeEdge = { id: string; source_id: string; target_id: string; label: string | null };
type Pos = { x: number; y: number };

// ─── Generic helpers ─────────────────────────────────────────────────────────

function buildAdjacency(edges: ArrangeEdge[]) {
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of edges) {
    if (!out.has(e.source_id)) out.set(e.source_id, []);
    out.get(e.source_id)!.push(e.target_id);
    if (!inc.has(e.target_id)) inc.set(e.target_id, []);
    inc.get(e.target_id)!.push(e.source_id);
  }
  return { out, inc };
}

// Longest-path layering, cycle-tolerant.
function longestPathLayers(nodes: ArrangeNode[], edges: ArrangeEdge[]): Map<string, number> {
  const { inc } = buildAdjacency(edges);
  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n.id, 0);
  const cap = nodes.length + 2;
  for (let pass = 0; pass < cap; pass++) {
    let changed = false;
    for (const n of nodes) {
      const parents = inc.get(n.id) ?? [];
      let best = 0;
      for (const p of parents) {
        const pc = layer.get(p);
        if (pc !== undefined && pc + 1 > best) best = pc + 1;
      }
      if (best !== layer.get(n.id)) {
        layer.set(n.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

// Find weakly-connected components.
function connectedComponents(nodes: ArrangeNode[], edges: ArrangeEdge[]): ArrangeNode[][] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source_id)?.add(e.target_id);
    adj.get(e.target_id)?.add(e.source_id);
  }
  const seen = new Set<string>();
  const idToNode = new Map(nodes.map((n) => [n.id, n] as const));
  const comps: ArrangeNode[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const stack = [n.id];
    const comp: ArrangeNode[] = [];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const nn = idToNode.get(id);
      if (nn) comp.push(nn);
      for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) stack.push(nb);
    }
    comps.push(comp);
  }
  // Largest component first so it gets placed at the top.
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

// Median-of-parents barycenter sweep — reorder nodes within each layer to
// reduce edge crossings. Two passes (forward + backward).
function barycenterReorder(layerToNodes: Map<number, ArrangeNode[]>, edges: ArrangeEdge[]) {
  const { inc, out } = buildAdjacency(edges);
  const layerKeys = [...layerToNodes.keys()].sort((a, b) => a - b);
  const indexInLayer = (id: string, layer: number) => {
    const arr = layerToNodes.get(layer) ?? [];
    return arr.findIndex((n) => n.id === id);
  };
  // Forward sweep: order each layer by median index of its parents in the
  // previous layer.
  for (let i = 1; i < layerKeys.length; i++) {
    const lk = layerKeys[i];
    const prev = layerKeys[i - 1];
    const arr = layerToNodes.get(lk)!;
    arr.sort((a, b) => barycenter(a.id, prev, inc) - barycenter(b.id, prev, inc));
  }
  // Backward sweep: order each layer by median index of its children.
  for (let i = layerKeys.length - 2; i >= 0; i--) {
    const lk = layerKeys[i];
    const next = layerKeys[i + 1];
    const arr = layerToNodes.get(lk)!;
    arr.sort((a, b) => barycenter(a.id, next, out) - barycenter(b.id, next, out));
  }
  function barycenter(id: string, neighborLayer: number, dir: Map<string, string[]>) {
    const neighbors = dir.get(id) ?? [];
    const idxs: number[] = [];
    for (const nb of neighbors) {
      const i = indexInLayer(nb, neighborLayer);
      if (i >= 0) idxs.push(i);
    }
    if (idxs.length === 0) return 9999; // unanchored go to end
    idxs.sort((a, b) => a - b);
    return idxs[Math.floor(idxs.length / 2)];
  }
}

// ─── Sugiyama horizontal-layered layout (reusable core) ──────────────────────
// Layers run left-to-right; nodes within a layer stack vertically.
// componentTopOffset is added to all y coordinates so components stack down
// the page without overlap.
function sugiyamaHorizontal(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  componentTopOffset: number,
  laneOf?: (n: ArrangeNode) => number, // optional sub-row inside a layer (for swimlanes)
): { positions: Record<string, Pos>; height: number } {
  if (nodes.length === 0) return { positions: {}, height: 0 };
  const layerOf = longestPathLayers(nodes, edges);
  const layerToNodes = new Map<number, ArrangeNode[]>();
  for (const n of nodes) {
    const l = layerOf.get(n.id) ?? 0;
    if (!layerToNodes.has(l)) layerToNodes.set(l, []);
    layerToNodes.get(l)!.push(n);
  }
  // Stable initial order: by (lane, original title) so first sweep has
  // deterministic seeds.
  for (const [, arr] of layerToNodes) {
    arr.sort((a, b) => {
      const la = laneOf?.(a) ?? 0;
      const lb = laneOf?.(b) ?? 0;
      if (la !== lb) return la - lb;
      return a.title.localeCompare(b.title);
    });
  }
  // Two crossing-reduction sweeps.
  barycenterReorder(layerToNodes, edges);
  barycenterReorder(layerToNodes, edges);

  // Pack: x = ORIGIN_X + layer * STEP_X ; y = ORIGIN_Y + componentTopOffset + index * STEP_Y
  // No overlap is possible — every node gets its own row inside a layer.
  const positions: Record<string, Pos> = {};
  let maxRows = 0;
  const layers = [...layerToNodes.keys()].sort((a, b) => a - b);
  for (const l of layers) {
    const arr = layerToNodes.get(l)!;
    arr.forEach((n, idx) => {
      positions[n.id] = {
        x: ORIGIN_X + l * STEP_X,
        y: ORIGIN_Y + componentTopOffset + idx * STEP_Y,
      };
    });
    maxRows = Math.max(maxRows, arr.length);
  }
  return { positions, height: maxRows * STEP_Y };
}

// Vertical variant — layer = row, nodes inside a layer stack horizontally.
function sugiyamaVertical(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  componentLeftOffset: number,
): { positions: Record<string, Pos>; width: number } {
  if (nodes.length === 0) return { positions: {}, width: 0 };
  const layerOf = longestPathLayers(nodes, edges);
  const layerToNodes = new Map<number, ArrangeNode[]>();
  for (const n of nodes) {
    const l = layerOf.get(n.id) ?? 0;
    if (!layerToNodes.has(l)) layerToNodes.set(l, []);
    layerToNodes.get(l)!.push(n);
  }
  for (const [, arr] of layerToNodes) arr.sort((a, b) => a.title.localeCompare(b.title));
  barycenterReorder(layerToNodes, edges);
  barycenterReorder(layerToNodes, edges);

  const positions: Record<string, Pos> = {};
  let maxCols = 0;
  const layers = [...layerToNodes.keys()].sort((a, b) => a - b);
  for (const l of layers) {
    const arr = layerToNodes.get(l)!;
    arr.forEach((n, idx) => {
      positions[n.id] = {
        x: ORIGIN_X + componentLeftOffset + idx * STEP_X,
        y: ORIGIN_Y + l * STEP_Y,
      };
    });
    maxCols = Math.max(maxCols, arr.length);
  }
  return { positions, width: maxCols * STEP_X };
}

// Run a Sugiyama layout per connected component, stacking components down.
function layoutByComponents(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  fn: (n: ArrangeNode[], e: ArrangeEdge[], offset: number) => { positions: Record<string, Pos>; height: number },
): Record<string, Pos> {
  const comps = connectedComponents(nodes, edges);
  const idToComp = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((n) => idToComp.set(n.id, i)));
  const positions: Record<string, Pos> = {};
  let yCursor = 0;
  for (const comp of comps) {
    const compIds = new Set(comp.map((n) => n.id));
    const compEdges = edges.filter((e) => compIds.has(e.source_id) && compIds.has(e.target_id));
    const { positions: compPos, height } = fn(comp, compEdges, yCursor);
    Object.assign(positions, compPos);
    yCursor += height + COMPONENT_GAP_Y;
  }
  return positions;
}

// ─── LOGIC BOARD VARIANTS ────────────────────────────────────────────────────

const LOGIC_LANES: { key: string; types: string[] }[] = [
  { key: "suspects", types: ["suspect"] },
  { key: "clues", types: ["clue"] },
  { key: "documents", types: ["document"] },
  { key: "envelopes", types: ["envelope"] },
  { key: "reasoning", types: ["deduction", "contradiction"] },
  { key: "distractions", types: ["red_herring", "hint", "note"] },
  { key: "solution", types: ["solution"] },
];
function laneIndexFor(nodeType: string): number {
  for (let i = 0; i < LOGIC_LANES.length; i++) {
    if (LOGIC_LANES[i].types.includes(nodeType)) return i;
  }
  return LOGIC_LANES.length;
}

// Variant 0 — "lanes": Sugiyama horizontal layout (the default).
function logicLayoutLanes(nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  return layoutByComponents(nodes, edges, (n, e, offset) =>
    sugiyamaHorizontal(n, e, offset, (node) => laneIndexFor(node.node_type)),
  );
}

// Variant 1 — "columns": Sugiyama vertical layout.
function logicLayoutColumns(nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  const comps = connectedComponents(nodes, edges);
  const positions: Record<string, Pos> = {};
  let xCursor = 0;
  for (const comp of comps) {
    const compIds = new Set(comp.map((n) => n.id));
    const compEdges = edges.filter((e) => compIds.has(e.source_id) && compIds.has(e.target_id));
    const { positions: compPos, width } = sugiyamaVertical(comp, compEdges, xCursor);
    Object.assign(positions, compPos);
    xCursor += width + COL_GAP;
  }
  return positions;
}

// Variant 2 — "suspects": one swimlane per suspect (by data.suspectId), each
// suspect's nodes laid out horizontally as Sugiyama within their band.
function logicLayoutBySuspect(nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  const suspectKey = (n: ArrangeNode): string => {
    const d = (n.data ?? {}) as { suspectId?: string; suspectName?: string };
    return d.suspectId ?? d.suspectName ?? "";
  };
  // Group: { "" → unassigned bucket }
  const groups = new Map<string, ArrangeNode[]>();
  for (const n of nodes) {
    const k = suspectKey(n);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(n);
  }
  const positions: Record<string, Pos> = {};
  let yCursor = 0;
  for (const [, members] of groups) {
    const memberIds = new Set(members.map((n) => n.id));
    const inGroupEdges = edges.filter((e) => memberIds.has(e.source_id) && memberIds.has(e.target_id));
    const { positions: gp, height } = sugiyamaHorizontal(members, inGroupEdges, yCursor);
    Object.assign(positions, gp);
    yCursor += Math.max(height, STEP_Y) + COMPONENT_GAP_Y;
  }
  return positions;
}

// Variant 3 — "compact": depth-first chain packer. Walk each chain root and
// pack chains into rows tightly.
function logicLayoutChains(nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  const { out, inc } = buildAdjacency(edges);
  const roots = nodes.filter((n) => (inc.get(n.id) ?? []).length === 0);
  if (roots.length === 0) roots.push(nodes[0]);
  const positions: Record<string, Pos> = {};
  const placed = new Set<string>();
  let row = 0;
  for (const root of roots) {
    let col = 0;
    let cur: string | undefined = root.id;
    while (cur && !placed.has(cur)) {
      positions[cur] = { x: ORIGIN_X + col * STEP_X, y: ORIGIN_Y + row * STEP_Y };
      placed.add(cur);
      col++;
      const next = (out.get(cur) ?? []).find((id) => !placed.has(id));
      cur = next;
    }
    row++;
  }
  // Remaining unplaced nodes — append below.
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    positions[n.id] = { x: ORIGIN_X, y: ORIGIN_Y + row * STEP_Y };
    placed.add(n.id);
    row++;
  }
  return positions;
}

// ─── FINAL BOARD VARIANTS ────────────────────────────────────────────────────

// Final-board node roles (stored in data.finalMapRole or inferred from node_type).
function finalLane(n: ArrangeNode): "logic" | "document" | "envelope" | "other" {
  const role = ((n.data ?? {}) as { finalMapRole?: string }).finalMapRole;
  if (role === "logic" || role === "document" || role === "envelope") return role;
  if (n.node_type === "envelope") return "envelope";
  if (n.node_type === "document") return "document";
  return "other";
}

// "bands" — three vertical bands left→right: Logic | Documents | Envelopes.
// Within each band we pack vertically with no overlap, ordered by edge
// barycenter so connections read straight across.
function finalLayoutBands(nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  const bands: Record<"logic" | "document" | "envelope" | "other", ArrangeNode[]> = {
    logic: [], document: [], envelope: [], other: [],
  };
  for (const n of nodes) bands[finalLane(n)].push(n);
  // Order each band by barycenter of its connections.
  const positions: Record<string, Pos> = {};
  const colX = { logic: ORIGIN_X, document: ORIGIN_X + STEP_X, envelope: ORIGIN_X + 2 * STEP_X, other: ORIGIN_X + 3 * STEP_X };
  for (const key of ["logic", "document", "envelope", "other"] as const) {
    const arr = bands[key];
    arr.sort((a, b) => {
      const ad = ((a.data ?? {}) as { docNumber?: number; envelopeNumber?: number }).docNumber ?? ((a.data ?? {}) as { envelopeNumber?: number }).envelopeNumber ?? 9999;
      const bd = ((b.data ?? {}) as { docNumber?: number; envelopeNumber?: number }).docNumber ?? ((b.data ?? {}) as { envelopeNumber?: number }).envelopeNumber ?? 9999;
      if (ad !== bd) return ad - bd;
      return a.title.localeCompare(b.title);
    });
    arr.forEach((n, i) => {
      positions[n.id] = { x: colX[key], y: ORIGIN_Y + i * STEP_Y };
    });
  }
  return positions;
}

// "stacked" — three horizontal bands top→bottom.
function finalLayoutStacked(nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  const bands: Record<"logic" | "document" | "envelope" | "other", ArrangeNode[]> = {
    logic: [], document: [], envelope: [], other: [],
  };
  for (const n of nodes) bands[finalLane(n)].push(n);
  const rowY = { logic: ORIGIN_Y, document: ORIGIN_Y + STEP_Y, envelope: ORIGIN_Y + 2 * STEP_Y, other: ORIGIN_Y + 3 * STEP_Y };
  const positions: Record<string, Pos> = {};
  for (const key of ["logic", "document", "envelope", "other"] as const) {
    const arr = bands[key];
    arr.sort((a, b) => {
      const ad = ((a.data ?? {}) as { docNumber?: number; envelopeNumber?: number }).docNumber ?? ((a.data ?? {}) as { envelopeNumber?: number }).envelopeNumber ?? 9999;
      const bd = ((b.data ?? {}) as { docNumber?: number; envelopeNumber?: number }).docNumber ?? ((b.data ?? {}) as { envelopeNumber?: number }).envelopeNumber ?? 9999;
      return ad - bd;
    });
    arr.forEach((n, i) => {
      positions[n.id] = { x: ORIGIN_X + i * STEP_X, y: rowY[key] };
    });
  }
  return positions;
}

// "envelope" — one column per envelope; logic chain spread along top.
function finalLayoutByEnvelope(nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  const positions: Record<string, Pos> = {};
  const envs = nodes.filter((n) => finalLane(n) === "envelope")
    .sort((a, b) => (((a.data ?? {}) as { envelopeNumber?: number }).envelopeNumber ?? 9999) - (((b.data ?? {}) as { envelopeNumber?: number }).envelopeNumber ?? 9999));
  const docs = nodes.filter((n) => finalLane(n) === "document");
  const logic = nodes.filter((n) => finalLane(n) === "logic");
  const others = nodes.filter((n) => finalLane(n) === "other");

  // Logic strip across the top.
  logic.sort((a, b) => a.title.localeCompare(b.title));
  logic.forEach((n, i) => { positions[n.id] = { x: ORIGIN_X + i * STEP_X, y: ORIGIN_Y }; });

  // Each envelope becomes a column starting one row below the logic strip.
  const envCol = new Map<string, number>();
  envs.forEach((env, i) => {
    envCol.set(env.id, i);
    positions[env.id] = { x: ORIGIN_X + i * STEP_X, y: ORIGIN_Y + STEP_Y };
  });
  // Place docs under their envelope.
  const { inc } = buildAdjacency(edges);
  const colCounters = new Map<number, number>();
  for (const d of docs) {
    const parents = inc.get(d.id) ?? [];
    const envParent = parents.find((p) => envCol.has(p));
    const col = envParent ? envCol.get(envParent)! : envs.length;
    const row = (colCounters.get(col) ?? 0) + 1;
    colCounters.set(col, row);
    positions[d.id] = { x: ORIGIN_X + col * STEP_X, y: ORIGIN_Y + (1 + row) * STEP_Y };
  }
  // Other nodes — bottom row.
  const lastRow = Math.max(0, ...[...colCounters.values()]) + 2;
  others.forEach((n, i) => { positions[n.id] = { x: ORIGIN_X + i * STEP_X, y: ORIGIN_Y + lastRow * STEP_Y }; });
  return positions;
}

// ─── Variant dispatcher ──────────────────────────────────────────────────────

const LOGIC_VARIANTS = ["lanes", "columns", "suspects", "compact"] as const;
const FINAL_VARIANTS = ["bands", "stacked", "envelope"] as const;
type LogicVariant = typeof LOGIC_VARIANTS[number];
type FinalVariant = typeof FINAL_VARIANTS[number];

function pickLogicLayout(variant: LogicVariant, nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  switch (variant) {
    case "columns": return logicLayoutColumns(nodes, edges);
    case "suspects": return logicLayoutBySuspect(nodes, edges);
    case "compact": return logicLayoutChains(nodes, edges);
    case "lanes":
    default: return logicLayoutLanes(nodes, edges);
  }
}
function pickFinalLayout(variant: FinalVariant, nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  switch (variant) {
    case "stacked": return finalLayoutStacked(nodes, edges);
    case "envelope": return finalLayoutByEnvelope(nodes, edges);
    case "bands":
    default: return finalLayoutBands(nodes, edges);
  }
}

// Compute tight bounding box so the client can fitView() perfectly.
function boundingBox(positions: Record<string, Pos>) {
  const ids = Object.keys(positions);
  if (ids.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + NODE_W > maxX) maxX = p.x + NODE_W;
    if (p.y + NODE_H > maxY) maxY = p.y + NODE_H;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ─── AI refine (group-hint mode) ─────────────────────────────────────────────
// The LLM no longer rewrites coordinates. It returns logical groupings —
// arrays of node ids that should sit adjacent — and we re-run the
// deterministic packer using those groups as a sub-lane override.
async function aiRefineGroups(
  model: string,
  project: { title?: string; subtitle?: string; solution_summary?: string } | null,
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  signalTimeoutMs: number,
): Promise<{ groups: string[][] | null; notes?: string; effectiveModel?: string; fallback?: string }> {
  const compactNodes = nodes.map((n) => ({
    id: n.id, type: n.node_type, title: (n.title || "").slice(0, 80),
    desc: (n.description || "").slice(0, 140),
  }));
  const compactEdges = edges.map((e) => ({ from: e.source_id, to: e.target_id, label: (e.label ?? "").slice(0, 40) }));
  const sys = `You are a story-structure editor for a printable mystery game's case board.

Your job: read the case brief, the nodes (with id, type, title, description), and the edges, then RETURN NARRATIVE-ROLE CLUSTERS — ordered groups of node ids that should sit together because they share a narrative role. Examples of clusters you should produce when relevant:

  • One cluster per SUSPECT — the suspect node + every clue, document, and deduction that points at (or away from) them, in the order the player will reach them.
  • A separate cluster for the RED HERRING storyline (suspect + the misleading clues + the deduction that disproves them).
  • A SOLUTION cluster — the final deductions and reveal at the end.
  • A "ENVELOPES SPINE" cluster — every envelope in number order along its own row.
  • A "FREE EVIDENCE" cluster for documents the player gets at the start that don't belong to a specific suspect chain.

Each group is an ordered array of node ids. Inside a group, list ids in READING ORDER (left-to-right or top-to-bottom). The deterministic packer will use group index as the lane index, so the first group becomes the topmost lane / leftmost column.

Rules:
- Every node should appear in exactly ONE group when possible.
- Use ids that exist in the input. Never invent ids.
- Order groups by importance: suspect chains first, then red herring, then envelopes, then solution.
- Add a 1-line "notes" string explaining the grouping (e.g. "3 suspect chains + 1 red herring + envelope spine + solution").

You DO NOT compute coordinates.`;
  const userPrompt = `PROJECT: "${project?.title ?? ""}" — ${project?.subtitle ?? ""}
${project?.solution_summary ? `SOLUTION SUMMARY (authoritative — use to identify the real killer vs red herrings):\n${project.solution_summary.slice(0, 1800)}\n` : ""}
NODES (${compactNodes.length}): ${JSON.stringify(compactNodes)}
EDGES (${compactEdges.length}): ${JSON.stringify(compactEdges)}
Return narrative-role clusters via the suggest_groups tool.`;
  const tool = {
    type: "function",
    function: {
      name: "suggest_groups",
      description: "Return narrative-role clusters: ordered groups of node ids that should sit together (one cluster per suspect chain, red herring, envelope spine, solution, etc.).",
      parameters: {
        type: "object",
        properties: {
          groups: { type: "array", items: { type: "array", items: { type: "string" } } },
          notes: { type: "string" },
        },
        required: ["groups"],
        additionalProperties: false,
      },
    },
  };
  try {
    const resp = await Promise.race<Response>([
      chatCompletions({
        model,
        messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "suggest_groups" } },
      }),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error(`AI refine timed out after ${signalTimeoutMs}ms`)), signalTimeoutMs)),
    ]);
    const fb = extractFallback(resp, model);
    if (!resp.ok) return { groups: null, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = call?.function?.arguments;
    if (!argsRaw) return { groups: null, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
    const args = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    const ids = new Set(nodes.map((n) => n.id));
    const groups = (args.groups ?? []).map((g: unknown) => Array.isArray(g) ? (g as string[]).filter((id) => ids.has(id)) : []).filter((g: string[]) => g.length > 0);
    return { groups, notes: args.notes, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
  } catch (err) {
    console.error("[arrange-canvas] AI refine threw", err);
    return { groups: null };
  }
}

// Re-run lane layout with an AI-suggested group ordering: nodes mentioned in
// the same group share a lane index so they stack vertically inside their
// layer.
function logicLayoutLanesWithGroups(nodes: ArrangeNode[], edges: ArrangeEdge[], groups: string[][]) {
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((id) => groupOf.set(id, i)));
  return layoutByComponents(nodes, edges, (n, e, offset) =>
    sugiyamaHorizontal(n, e, offset, (node) => groupOf.get(node.id) ?? (groups.length + laneIndexFor(node.node_type))),
  );
}

// ─── HTTP entry ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, board = "logic", modelOverride, mode = "deterministic", variantIndex = 0, variant: variantName } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supa = createClient(SUPABASE_URL, SERVICE);
    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);

    const [{ data: project }, { data: dbNodes }, { data: dbEdges }] = await Promise.all([
      supa.from("projects").select("title, subtitle, solution_summary, ai_provider_planning").eq("id", projectId).single(),
      supa.from("canvas_nodes").select("id, title, node_type, description, data, position_x, position_y").eq("project_id", projectId).eq("board", board),
      supa.from("canvas_edges").select("id, source_id, target_id, label").eq("project_id", projectId).eq("board", board),
    ]);
    const nodes = (dbNodes ?? []) as ArrangeNode[];
    const edges = (dbEdges ?? []) as ArrangeEdge[];
    if (nodes.length === 0) {
      return new Response(JSON.stringify({ ok: true, positions: {}, count: 0, source: "noop" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const variants = board === "final" ? FINAL_VARIANTS : LOGIC_VARIANTS;
    const idx = ((Number(variantIndex) || 0) % variants.length + variants.length) % variants.length;
    const chosenVariant = (typeof variantName === "string" && (variants as readonly string[]).includes(variantName))
      ? (variantName as LogicVariant | FinalVariant)
      : variants[idx];

    let positions: Record<string, Pos> =
      board === "final"
        ? pickFinalLayout(chosenVariant as FinalVariant, nodes, edges)
        : pickLogicLayout(chosenVariant as LogicVariant, nodes, edges);
    let source: "deterministic" | "ai-refine" | "ai-refine-fallback" = "deterministic";
    let aiNotes: string | undefined;
    let effectiveModel: string | undefined;
    let fallbackTag = "none";
    let usedModel: string | undefined;

    if (mode === "ai-refine" && board === "logic") {
      const modelKey = (modelOverride as string) || (project?.ai_provider_planning as string) || "gemini-3-flash";
      const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL["gemini-3-flash"];
      usedModel = model;
      const refined = await aiRefineGroups(model, project ?? null, nodes, edges, 30_000);
      effectiveModel = refined.effectiveModel;
      fallbackTag = refined.fallback ?? "none";
      if (refined.groups && refined.groups.length > 0) {
        positions = logicLayoutLanesWithGroups(nodes, edges, refined.groups);
        source = "ai-refine";
        aiNotes = refined.notes;
      } else {
        source = "ai-refine-fallback";
      }
    }

    // Single batched upsert.
    const rows = nodes.map((n) => ({
      id: n.id,
      project_id: projectId,
      board,
      node_type: n.node_type,
      title: n.title,
      data: n.data ?? {},
      position_x: positions[n.id]?.x ?? n.position_x ?? 0,
      position_y: positions[n.id]?.y ?? n.position_y ?? 0,
    }));
    const { error: writeErr } = await supa.from("canvas_nodes").upsert(rows, { onConflict: "id" });
    if (writeErr) console.error("[arrange-canvas] batched upsert", writeErr);

    const bbox = boundingBox(positions);
    await logAiRun({
      userId: callerUserId, projectId, surface: "arrange-canvas",
      requestedModel: usedModel ?? "deterministic",
      effectiveModel: effectiveModel ?? (usedModel ?? "deterministic"),
      fallback: fallbackTag,
      status: writeErr ? "error" : "ok",
      latencyMs: Date.now() - startedAt,
      promptExcerpt: `${nodes.length} nodes, ${edges.length} edges, mode=${mode}, board=${board}, variant=${chosenVariant}`,
      errorMessage: writeErr ? writeErr.message : undefined,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        positions,
        count: Object.keys(positions).length,
        source,
        variant: chosenVariant,
        variantIndex: idx,
        variantCount: variants.length,
        notes: aiNotes,
        model: usedModel,
        effectiveModel,
        fallback: fallbackTag,
        bbox,
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

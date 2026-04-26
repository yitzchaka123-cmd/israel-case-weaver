// Smart layout for the case-board canvas.
//
// Default mode is **deterministic**: pure-JS topological/role-aware layout
// that runs in tens of milliseconds and ignores the LLM entirely. Optional
// `mode: "ai-refine"` calls the configured Logic Flow model to polish an
// already-good layout (instead of building one from scratch), with a much
// shorter timeout.
//
// Each board has a CYCLE of smart layout variants. Pressing "Smart arrange"
// repeatedly walks through the variants so the user can preview the same
// case from different structural angles. Each variant is still deterministic
// and context-aware (uses node_type, finalMapRole, envelopeNumber, edges).
//
// Logic-board variants (cycled in order):
//   0 "lanes"   — 7 horizontal lanes by node_type, columns from longest-path.
//   1 "columns" — vertical lanes (lane = column, depth = row). Same role
//                 grouping but reads top→bottom.
//   2 "suspects"— grouped by primary suspect (data.suspectId / suspectName),
//                 each suspect getting their own horizontal swimlane band.
//   3 "compact" — depth-first chain layout: follow each chain root through
//                 its successors, packing chains tightly into rows.
//
// Final-board variants (cycled in order):
//   0 "bands"      — Logic | Documents | Envelopes left→right (default).
//   1 "stacked"    — Logic top, Documents middle, Envelopes bottom (rows).
//   2 "envelope"   — grouped by envelope: each envelope owns a column of
//                    its documents, with the logic chain spread along top.
//
// All position writes are committed in a single batched upsert.
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

// Visual constants — keep aligned with the client's NodeTypes spacing so the
// edges + labels stay legible.
const NODE_W = 240;
const NODE_H = 130;
const COL_GAP = 140;
const ROW_GAP = 140;
const STEP_X = NODE_W + COL_GAP; // 380
const STEP_Y = NODE_H + ROW_GAP; // 270
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

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

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// Longest-path layering: column = length of longest path from any source to
// this node (0-indexed). Tolerant of cycles (capped at N iterations).
function longestPathColumns(nodes: ArrangeNode[], edges: ArrangeEdge[]): Map<string, number> {
  const { inc } = buildAdjacency(edges);
  const col = new Map<string, number>();
  for (const n of nodes) col.set(n.id, 0);
  const cap = nodes.length + 2;
  for (let pass = 0; pass < cap; pass++) {
    let changed = false;
    for (const n of nodes) {
      const parents = inc.get(n.id) ?? [];
      let best = 0;
      for (const p of parents) {
        const pc = col.get(p);
        if (pc !== undefined && pc + 1 > best) best = pc + 1;
      }
      if (best !== col.get(n.id)) {
        col.set(n.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return col;
}

// Final pass: if any two nodes overlap (centers closer than NODE_W+40 ×
// NODE_H+60), push the later one down by a row.
function resolveOverlaps(positions: Record<string, Pos>) {
  const ids = Object.keys(positions);
  const minDx = NODE_W + 40;
  const minDy = NODE_H + 60;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]];
      const b = positions[ids[j]];
      if (Math.abs(a.x - b.x) < minDx && Math.abs(a.y - b.y) < minDy) {
        positions[ids[j]] = { x: b.x, y: b.y + STEP_Y };
      }
    }
  }
}

// ─── LOGIC board: 7-lane topological layout ──────────────────────────────────

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
  return LOGIC_LANES.length; // catch-all bottom row
}

function deterministicLogicLayout(nodes: ArrangeNode[], edges: ArrangeEdge[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const cols = longestPathColumns(nodes, edges);
  const dataOf = (n: ArrangeNode) =>
    (n.data ?? {}) as { envelopeNumber?: number; docNumber?: number };

  // Group nodes by lane
  const byLane = new Map<number, ArrangeNode[]>();
  for (const n of nodes) {
    const lane = laneIndexFor(n.node_type);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane)!.push(n);
  }

  // Envelope nodes get their own column ordering (by envelopeNumber), so they
  // form a clean spine even when the graph chain doesn't fully connect them.
  const envLane = byLane.get(LOGIC_LANES.findIndex((l) => l.key === "envelopes")) ?? [];
  envLane.sort((a, b) => (dataOf(a).envelopeNumber ?? 9999) - (dataOf(b).envelopeNumber ?? 9999));
  envLane.forEach((n, i) => cols.set(n.id, Math.max(cols.get(n.id) ?? 0, i)));

  // Document nodes: ordered by envelopeNumber then docNumber so they flow
  // in the same reading direction as the envelopes.
  const docLane = byLane.get(LOGIC_LANES.findIndex((l) => l.key === "documents")) ?? [];
  docLane.sort((a, b) => {
    const ae = dataOf(a).envelopeNumber ?? 9999;
    const be = dataOf(b).envelopeNumber ?? 9999;
    if (ae !== be) return ae - be;
    return (dataOf(a).docNumber ?? 9999) - (dataOf(b).docNumber ?? 9999);
  });

  // Walk lanes top-to-bottom and place nodes, sorted by their column index.
  // Within a lane, if two nodes resolve to the same column we shift the second
  // into the next free column on the same row.
  for (let lane = 0; lane < LOGIC_LANES.length; lane++) {
    const laneNodes = byLane.get(lane) ?? [];
    if (laneNodes.length === 0) continue;
    laneNodes.sort((a, b) => (cols.get(a.id) ?? 0) - (cols.get(b.id) ?? 0));
    const used = new Set<number>();
    const y = ORIGIN_Y + lane * STEP_Y;
    for (const n of laneNodes) {
      let c = cols.get(n.id) ?? 0;
      while (used.has(c)) c++;
      used.add(c);
      positions[n.id] = { x: ORIGIN_X + c * STEP_X, y };
    }
  }

  // Catch-all for any node whose lane wasn't matched (unusual node types).
  const trailingY = ORIGIN_Y + LOGIC_LANES.length * STEP_Y;
  let trailCol = 0;
  for (const n of nodes) {
    if (!positions[n.id]) {
      positions[n.id] = { x: ORIGIN_X + trailCol++ * STEP_X, y: trailingY };
    }
  }

  resolveOverlaps(positions);
  return positions;
}

// Variant 1: vertical lanes (rotate 90°). Each role gets a column;
// topological depth pushes nodes downward.
function logicLayoutColumns(nodes: ArrangeNode[], edges: ArrangeEdge[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const depths = longestPathColumns(nodes, edges);
  const byLane = new Map<number, ArrangeNode[]>();
  for (const n of nodes) {
    const lane = laneIndexFor(n.node_type);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane)!.push(n);
  }
  for (let lane = 0; lane < LOGIC_LANES.length + 1; lane++) {
    const arr = byLane.get(lane) ?? [];
    if (arr.length === 0) continue;
    arr.sort((a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0));
    const used = new Set<number>();
    const x = ORIGIN_X + lane * STEP_X;
    for (const n of arr) {
      let r = depths.get(n.id) ?? 0;
      while (used.has(r)) r++;
      used.add(r);
      positions[n.id] = { x, y: ORIGIN_Y + r * STEP_Y };
    }
  }
  resolveOverlaps(positions);
  return positions;
}

// Variant 2: grouped by suspect. Each suspect (or "unassigned") owns a
// horizontal band; within the band we render the same lane structure.
function logicLayoutBySuspect(nodes: ArrangeNode[], edges: ArrangeEdge[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const dataOf = (n: ArrangeNode) =>
    (n.data ?? {}) as { suspectId?: string; suspectName?: string; suspectIds?: string[] };
  // Build suspect key per node
  const keyOf = (n: ArrangeNode): string => {
    const d = dataOf(n);
    if (n.node_type === "suspect") return n.id; // suspect anchors its own band
    const k = d.suspectId || (Array.isArray(d.suspectIds) && d.suspectIds[0]) || d.suspectName;
    return k ?? "__unassigned__";
  };
  // Suspect nodes establish band order
  const suspectNodes = nodes.filter((n) => n.node_type === "suspect");
  const bandOrder: string[] = [];
  const seen = new Set<string>();
  for (const s of suspectNodes) {
    bandOrder.push(s.id);
    seen.add(s.id);
  }
  for (const n of nodes) {
    const k = keyOf(n);
    if (!seen.has(k)) {
      bandOrder.push(k);
      seen.add(k);
    }
  }
  const depths = longestPathColumns(nodes, edges);
  // Sub-lane within each band: roles other than suspect
  const SUB_LANES = ["clue", "document", "envelope", "deduction", "red_herring", "solution"];
  const subLaneIdx = (t: string) => {
    const i = SUB_LANES.indexOf(t);
    return i < 0 ? SUB_LANES.length : i;
  };
  const BAND_HEIGHT = (SUB_LANES.length + 1) * STEP_Y;
  bandOrder.forEach((bandKey, bandIdx) => {
    const bandY0 = ORIGIN_Y + bandIdx * BAND_HEIGHT;
    const bandNodes = nodes.filter((n) => keyOf(n) === bandKey);
    // Suspect head sits at top-left of the band
    const head = bandNodes.find((n) => n.node_type === "suspect");
    if (head) positions[head.id] = { x: ORIGIN_X, y: bandY0 };
    // Other nodes by sub-lane row, depth column
    const others = bandNodes.filter((n) => n.node_type !== "suspect");
    const used = new Map<number, Set<number>>(); // row → cols used
    for (const n of others) {
      const row = subLaneIdx(n.node_type) + 1; // +1 leaves row 0 for suspect
      let col = (depths.get(n.id) ?? 0) + 1; // +1 leaves col 0 for suspect anchor
      if (!used.has(row)) used.set(row, new Set());
      const u = used.get(row)!;
      while (u.has(col)) col++;
      u.add(col);
      positions[n.id] = { x: ORIGIN_X + col * STEP_X, y: bandY0 + row * STEP_Y };
    }
  });
  // Anything missed
  let trailRow = bandOrder.length * (SUB_LANES.length + 1);
  for (const n of nodes) {
    if (!positions[n.id]) {
      positions[n.id] = { x: ORIGIN_X, y: ORIGIN_Y + trailRow * STEP_Y };
      trailRow++;
    }
  }
  resolveOverlaps(positions);
  return positions;
}

// Variant 3: depth-first chain packing. Walk each root-to-leaf chain into
// its own row, packing chains tightly so related deductions read along a line.
function logicLayoutChains(nodes: ArrangeNode[], edges: ArrangeEdge[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const { out, inc } = buildAdjacency(edges);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  // Roots: no incoming edges. Sort by lane so suspects come first.
  const roots = nodes
    .filter((n) => (inc.get(n.id) ?? []).length === 0)
    .sort((a, b) => laneIndexFor(a.node_type) - laneIndexFor(b.node_type));
  let row = 0;
  const placeChain = (startId: string) => {
    const stack: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
    let chainPlaced = false;
    while (stack.length) {
      const { id, depth } = stack.pop()!;
      if (visited.has(id) || !nodeById.has(id)) continue;
      visited.add(id);
      positions[id] = { x: ORIGIN_X + depth * STEP_X, y: ORIGIN_Y + row * STEP_Y };
      chainPlaced = true;
      const children = (out.get(id) ?? []).slice().reverse();
      for (const c of children) stack.push({ id: c, depth: depth + 1 });
    }
    if (chainPlaced) row++;
  };
  for (const r of roots) placeChain(r.id);
  // Disconnected nodes (cycles or isolated)
  for (const n of nodes) if (!visited.has(n.id)) placeChain(n.id);
  resolveOverlaps(positions);
  return positions;
}

// ─── FINAL board: 3-band role-aware layout ───────────────────────────────────

// Band A (logic chain) on the left, Band B (documents) middle, Band C
// (envelopes) right. Documents align horizontally with the logic node they
// materialise; envelopes align with the row of their highest-numbered doc.
function deterministicFinalLayout(nodes: ArrangeNode[], _edges: ArrangeEdge[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const dataOf = (n: ArrangeNode) =>
    (n.data ?? {}) as {
      envelopeNumber?: number;
      docNumber?: number;
      finalMapRole?: string;
      sourceLogicNodeId?: string;
      sourceLogicNodeIds?: string[];
    };

  const logicNodes = nodes.filter((n) => dataOf(n).finalMapRole === "logic");
  const docNodes = nodes.filter((n) => n.node_type === "document");
  const envNodes = nodes.filter((n) => n.node_type === "envelope");
  // Anything else (rare) — suspects pulled across, plain notes, etc.
  const otherNodes = nodes.filter(
    (n) => n.node_type !== "document" && n.node_type !== "envelope" && dataOf(n).finalMapRole !== "logic",
  );

  const BAND_A_X = ORIGIN_X;                       // logic chain
  const BAND_B_X = ORIGIN_X + 4 * STEP_X;          // documents (~4 cols right)
  const BAND_C_X = ORIGIN_X + 7 * STEP_X;          // envelopes (~3 cols further)

  // ── Band A: logic chain. Reuse the logic-board layout heuristic so the
  // relative shape matches what the user already approved. We place them by
  // their own node_type lane, but constrained to a narrow x range.
  const logicCols = longestPathColumns(logicNodes, []); // edges among logic only would be ideal; keep simple
  const logicByLane = new Map<number, ArrangeNode[]>();
  for (const n of logicNodes) {
    const lane = laneIndexFor(n.node_type);
    if (!logicByLane.has(lane)) logicByLane.set(lane, []);
    logicByLane.get(lane)!.push(n);
  }
  // Track the row-Y assigned to each logic node id (for document alignment below).
  const logicRowY = new Map<string, number>();
  let logicRow = 0;
  for (let lane = 0; lane < LOGIC_LANES.length + 1; lane++) {
    const laneNodes = logicByLane.get(lane) ?? [];
    if (laneNodes.length === 0) continue;
    laneNodes.sort((a, b) => (logicCols.get(a.id) ?? 0) - (logicCols.get(b.id) ?? 0));
    // Place vertically — one logic node per row in Band A so docs can align.
    for (const n of laneNodes) {
      const y = ORIGIN_Y + logicRow * STEP_Y;
      positions[n.id] = { x: BAND_A_X, y };
      logicRowY.set(n.id, y);
      logicRow++;
    }
  }

  // ── Band B: documents. Each doc snaps to the row of its sourceLogicNode.
  // Multiple docs sharing a source stack into adjacent columns within Band B.
  const perRowCols = new Map<number, number>(); // y → next free column index inside Band B
  // Doc 0 should sit at the very top.
  const sortedDocs = [...docNodes].sort((a, b) => {
    const an = dataOf(a).docNumber ?? 9999;
    const bn = dataOf(b).docNumber ?? 9999;
    return an - bn;
  });
  let nextOrphanRow = 0;
  for (const d of sortedDocs) {
    const dd = dataOf(d);
    const sourceId = (dd.sourceLogicNodeIds && dd.sourceLogicNodeIds[0]) || dd.sourceLogicNodeId;
    let y = sourceId ? logicRowY.get(sourceId) ?? -1 : -1;
    if (y < 0) {
      // Doc with no logic anchor — stack from the top in its own column.
      y = ORIGIN_Y + nextOrphanRow * STEP_Y;
      nextOrphanRow++;
    }
    const colIdx = perRowCols.get(y) ?? 0;
    perRowCols.set(y, colIdx + 1);
    positions[d.id] = { x: BAND_B_X + colIdx * STEP_X, y };
  }

  // ── Band C: envelopes. Sort by envelope number, place top-to-bottom.
  // Snap each envelope to the row of its highest-row document if any document
  // links into it via envelopeNumber; otherwise space them top-to-bottom.
  const sortedEnvs = [...envNodes].sort(
    (a, b) => (dataOf(a).envelopeNumber ?? 9999) - (dataOf(b).envelopeNumber ?? 9999),
  );
  // Map envelopeNumber → highest doc Y, so the envelope sits at the bottom of
  // its document column (where the "physical insert in envelope N" arrows
  // converge).
  const envYByNumber = new Map<number, number>();
  for (const d of sortedDocs) {
    const dd = dataOf(d);
    if (typeof dd.envelopeNumber === "number") {
      const y = positions[d.id]?.y ?? ORIGIN_Y;
      const cur = envYByNumber.get(dd.envelopeNumber);
      if (cur === undefined || y > cur) envYByNumber.set(dd.envelopeNumber, y);
    }
  }
  sortedEnvs.forEach((e, i) => {
    const num = dataOf(e).envelopeNumber;
    let y = (typeof num === "number" ? envYByNumber.get(num) : undefined) ?? (ORIGIN_Y + i * STEP_Y);
    positions[e.id] = { x: BAND_C_X, y };
  });

  // Anything else goes below Band A.
  let otherRow = logicRow;
  for (const n of otherNodes) {
    if (positions[n.id]) continue;
    positions[n.id] = { x: BAND_A_X, y: ORIGIN_Y + otherRow * STEP_Y };
    otherRow++;
  }

  // Final overlap sweep — envelopes sometimes land on top of each other when
  // multiple share a doc row.
  resolveOverlaps(positions);
  return positions;
}

// Final variant 1: stacked horizontally — Logic on top row(s), Documents in
// the middle, Envelopes at the bottom. Useful on tall screens.
function finalLayoutStacked(nodes: ArrangeNode[], _edges: ArrangeEdge[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const dataOf = (n: ArrangeNode) =>
    (n.data ?? {}) as { envelopeNumber?: number; docNumber?: number; finalMapRole?: string };
  const logicNodes = nodes.filter((n) => dataOf(n).finalMapRole === "logic");
  const docNodes = [...nodes.filter((n) => n.node_type === "document")].sort(
    (a, b) => (dataOf(a).docNumber ?? 9999) - (dataOf(b).docNumber ?? 9999),
  );
  const envNodes = [...nodes.filter((n) => n.node_type === "envelope")].sort(
    (a, b) => (dataOf(a).envelopeNumber ?? 9999) - (dataOf(b).envelopeNumber ?? 9999),
  );
  const others = nodes.filter(
    (n) => n.node_type !== "document" && n.node_type !== "envelope" && dataOf(n).finalMapRole !== "logic",
  );
  // Up to 8 per row, then wrap.
  const place = (arr: ArrangeNode[], rowStart: number, perRow = 8) => {
    let lastRow = rowStart;
    arr.forEach((n, i) => {
      const r = rowStart + Math.floor(i / perRow);
      const c = i % perRow;
      lastRow = r;
      positions[n.id] = { x: ORIGIN_X + c * STEP_X, y: ORIGIN_Y + r * STEP_Y };
    });
    return lastRow + 1;
  };
  const afterLogic = place(logicNodes, 0);
  const afterDocs = place(docNodes, afterLogic + 1);
  const afterEnvs = place(envNodes, afterDocs + 1);
  place(others, afterEnvs + 1);
  resolveOverlaps(positions);
  return positions;
}

// Final variant 2: grouped by envelope. Each envelope owns a column with its
// documents stacked beneath it; the logic chain spreads along the top.
function finalLayoutByEnvelope(nodes: ArrangeNode[], _edges: ArrangeEdge[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const dataOf = (n: ArrangeNode) =>
    (n.data ?? {}) as { envelopeNumber?: number; docNumber?: number; finalMapRole?: string };
  const logicNodes = nodes.filter((n) => dataOf(n).finalMapRole === "logic");
  const docNodes = nodes.filter((n) => n.node_type === "document");
  const envNodes = [...nodes.filter((n) => n.node_type === "envelope")].sort(
    (a, b) => (dataOf(a).envelopeNumber ?? 9999) - (dataOf(b).envelopeNumber ?? 9999),
  );
  const others = nodes.filter(
    (n) => n.node_type !== "document" && n.node_type !== "envelope" && dataOf(n).finalMapRole !== "logic",
  );
  // Logic chain across the top, packed in rows of 8.
  logicNodes.forEach((n, i) => {
    const r = Math.floor(i / 8);
    const c = i % 8;
    positions[n.id] = { x: ORIGIN_X + c * STEP_X, y: ORIGIN_Y + r * STEP_Y };
  });
  const logicRows = Math.max(1, Math.ceil(logicNodes.length / 8));
  // Each envelope = column. Below it: that envelope's documents (sorted by docNumber).
  envNodes.forEach((env, idx) => {
    const x = ORIGIN_X + idx * STEP_X;
    const y0 = ORIGIN_Y + (logicRows + 1) * STEP_Y;
    positions[env.id] = { x, y: y0 };
    const num = dataOf(env).envelopeNumber;
    const docs = docNodes
      .filter((d) => dataOf(d).envelopeNumber === num)
      .sort((a, b) => (dataOf(a).docNumber ?? 9999) - (dataOf(b).docNumber ?? 9999));
    docs.forEach((d, i) => {
      positions[d.id] = { x, y: y0 + (i + 1) * STEP_Y };
    });
  });
  // Orphan docs (no envelope) → trailing column on the right.
  const orphanCol = envNodes.length + 1;
  const orphanX = ORIGIN_X + orphanCol * STEP_X;
  const y0 = ORIGIN_Y + (logicRows + 1) * STEP_Y;
  let orphanRow = 0;
  for (const d of docNodes) {
    if (positions[d.id]) continue;
    positions[d.id] = { x: orphanX, y: y0 + orphanRow * STEP_Y };
    orphanRow++;
  }
  // Others stacked below logic, left side.
  others.forEach((n, i) => {
    if (positions[n.id]) return;
    positions[n.id] = { x: ORIGIN_X, y: ORIGIN_Y + (logicRows + 1 + envNodes.length + i) * STEP_Y };
  });
  resolveOverlaps(positions);
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
    default: return deterministicLogicLayout(nodes, edges);
  }
}
function pickFinalLayout(variant: FinalVariant, nodes: ArrangeNode[], edges: ArrangeEdge[]) {
  switch (variant) {
    case "stacked": return finalLayoutStacked(nodes, edges);
    case "envelope": return finalLayoutByEnvelope(nodes, edges);
    case "bands":
    default: return deterministicFinalLayout(nodes, edges);
  }
}
// ─── AI refine path (optional) ───────────────────────────────────────────────

async function aiRefine(
  model: string,
  project: { title?: string; subtitle?: string; solution_summary?: string } | null,
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  seed: Record<string, Pos>,
  signalTimeoutMs: number,
): Promise<{ positions: Record<string, Pos> | null; notes?: string; effectiveModel?: string; fallback?: string }> {
  const compactNodes = nodes.map((n) => {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const p = seed[n.id] ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: n.node_type,
      title: (n.title || "").slice(0, 80),
      x: p.x,
      y: p.y,
      envelopeNumber: typeof d.envelopeNumber === "number" ? d.envelopeNumber : undefined,
      docNumber: typeof d.docNumber === "number" ? d.docNumber : undefined,
    };
  });
  const compactEdges = edges.map((e) => ({ from: e.source_id, to: e.target_id, label: (e.label ?? "").slice(0, 40) }));

  const sys = `You are a layout polish pass for a mystery-game case board. You receive a set of node positions that already work — your job is to make ONLY small, surgical adjustments to improve readability:
- Move nodes to avoid label collisions on labelled edges.
- Group nodes that share a suspect / topic into the same column where possible.
- Keep node centers at least ${NODE_W + 40}px apart horizontally OR ${NODE_H + 60}px apart vertically.
- Preserve the overall lane / band structure of the input. Do NOT rebuild the layout from scratch.
Return EVERY node id with integer (x, y) coordinates, even unchanged ones.`;
  const userPrompt = `PROJECT: "${project?.title ?? ""}" — ${project?.subtitle ?? ""}
${project?.solution_summary ? `SOLUTION (context only):\n${(project.solution_summary as string).slice(0, 600)}\n` : ""}
EXISTING POSITIONS (${compactNodes.length}):
${JSON.stringify(compactNodes)}

EDGES (${compactEdges.length}):
${JSON.stringify(compactEdges)}

Return refined positions for all ${compactNodes.length} nodes via the arrange_board tool.`;

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
              },
              required: ["id", "x", "y"],
              additionalProperties: false,
            },
          },
          notes: { type: "string" },
        },
        required: ["positions"],
        additionalProperties: false,
      },
    },
  };

  try {
    const resp = await Promise.race<Response>([
      chatCompletions({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "arrange_board" } },
      }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error(`AI refine timed out after ${signalTimeoutMs}ms`)), signalTimeoutMs),
      ),
    ]);
    const fb = extractFallback(resp, model);
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("[arrange-canvas] AI refine error", resp.status, t.slice(0, 300));
      return { positions: null, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
    }
    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = call?.function?.arguments;
    if (!argsRaw) return { positions: null, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
    let args: { positions?: { id: string; x: number; y: number }[]; notes?: string };
    try {
      args = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    } catch {
      return { positions: null, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
    }
    const pos: Record<string, Pos> = {};
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const p of args.positions ?? []) {
      if (!p || typeof p.id !== "string" || !nodeIds.has(p.id)) continue;
      const x = Math.round(Number(p.x));
      const y = Math.round(Number(p.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pos[p.id] = { x, y };
    }
    // Require near-full coverage on a refine pass.
    if (Object.keys(pos).length < Math.ceil(nodes.length * 0.9)) return { positions: null, notes: args.notes, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
    resolveOverlaps(pos);
    return { positions: pos, notes: args.notes, effectiveModel: fb.effectiveModel, fallback: fb.fallback };
  } catch (err) {
    console.error("[arrange-canvas] AI refine threw", err);
    return { positions: null };
  }
}

// ─── HTTP entry ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, board = "logic", modelOverride, mode = "deterministic", variantIndex = 0, variant: variantName } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SERVICE);
    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);

    const [{ data: project }, { data: dbNodes }, { data: dbEdges }] = await Promise.all([
      supa.from("projects").select("title, subtitle, solution_summary, ai_provider_planning").eq("id", projectId).single(),
      supa.from("canvas_nodes").select("id, title, node_type, description, data, position_x, position_y")
        .eq("project_id", projectId).eq("board", board),
      supa.from("canvas_edges").select("id, source_id, target_id, label")
        .eq("project_id", projectId).eq("board", board),
    ]);

    const nodes = (dbNodes ?? []) as ArrangeNode[];
    const edges = (dbEdges ?? []) as ArrangeEdge[];
    if (nodes.length === 0) {
      return new Response(JSON.stringify({ ok: true, positions: {}, count: 0, source: "noop" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick a smart-layout variant. Each "Smart arrange" press from the client
    // increments variantIndex so users cycle through different sensible layouts.
    const variants = board === "final" ? FINAL_VARIANTS : LOGIC_VARIANTS;
    const idx = ((Number(variantIndex) || 0) % variants.length + variants.length) % variants.length;
    const chosenVariant =
      (typeof variantName === "string" && variants.includes(variantName as never))
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

    if (mode === "ai-refine") {
      const modelKey = (modelOverride as string) || (project?.ai_provider_planning as string) || "gemini-3-flash";
      const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL["gemini-3-flash"];
      usedModel = model;
      // 30s timeout — refine has a head start, doesn't need 75s.
      const refined = await aiRefine(model, project ?? null, nodes, edges, positions, 30_000);
      effectiveModel = refined.effectiveModel;
      fallbackTag = refined.fallback ?? "none";
      if (refined.positions) {
        positions = refined.positions;
        source = "ai-refine";
        aiNotes = refined.notes;
      } else {
        source = "ai-refine-fallback";
      }
    }

    // Single batched upsert for all positions.
    const rows = nodes.map((n) => ({
      id: n.id,
      project_id: projectId,
      board,
      // canvas_nodes has NOT NULL on these — supabase upsert needs them present
      // even though we only intend to update position_x / position_y.
      node_type: n.node_type,
      title: n.title,
      data: n.data ?? {},
      position_x: positions[n.id]?.x ?? n.position_x ?? 0,
      position_y: positions[n.id]?.y ?? n.position_y ?? 0,
    }));
    const { error: writeErr } = await supa
      .from("canvas_nodes")
      .upsert(rows, { onConflict: "id" });
    if (writeErr) console.error("[arrange-canvas] batched upsert", writeErr);

    await logAiRun({
      userId: callerUserId,
      projectId,
      surface: "arrange-canvas",
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

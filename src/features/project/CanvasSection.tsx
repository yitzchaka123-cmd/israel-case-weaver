import { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
  Background, BackgroundVariant, Controls, MiniMap, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type NodeChange, type EdgeChange, type Node as RFNode,
  applyNodeChanges, applyEdgeChanges, ReactFlowProvider,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Wand2, CheckCircle2, Loader2, ScrollText, Sparkles, FileText, ExternalLink, ChevronDown, AlertTriangle, X, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { nodeTypes as caseNodeTypes, getNodeMeta, NODE_META } from "./canvas/CanvasNodeTypes";

// Per-device default. Overridable from Settings → AI provider routing → Logic flow.
// Stored in localStorage so it persists per-browser. Note: "openai-5.2" routes
// through your OpenAI key directly (not Lovable AI credits) — see ai-router.ts.
export const LOGIC_FLOW_MODELS = [
  { value: "openai-5.4", label: "ChatGPT 5.4 (newest · your OpenAI key)" },
  { value: "openai-5.2", label: "ChatGPT 5.2 (default · your OpenAI key)" },
  { value: "openai", label: "ChatGPT 5 (your OpenAI key)" },
  { value: "openai-mini", label: "ChatGPT 5 mini (your OpenAI key)" },
  { value: "openai-nano", label: "ChatGPT 5 nano (your OpenAI key)" },
  { value: "claude", label: "Claude Sonnet 4.5 (your Anthropic key)" },
  { value: "claude-opus", label: "Claude Opus 4.5 (your Anthropic key)" },
  { value: "gemini-direct-pro", label: "Gemini 2.5 Pro (your Gemini key)" },
  { value: "lovable", label: "Gemini 3.1 Pro (Lovable AI credits)" },
  { value: "gemini-flash", label: "Gemini 2.5 Flash (Lovable AI credits)" },
  { value: "gemini-flash-lite", label: "Gemini 2.5 Flash Lite (Lovable AI credits)" },
];
export const LOGIC_FLOW_MODEL_KEY = "logic-flow-model";
export const LOGIC_FLOW_MODEL_DEFAULT = "openai-5.2";

type Board = "logic" | "final";

const NODE_TYPES = (Object.entries(NODE_META) as [string, { label: string; accent: string }][])
  .map(([t, m]) => ({ t, l: m.label, c: m.accent }));

export function CanvasSection({ projectId }: { projectId: string }) {
  const [board, setBoard] = useState<Board>("logic");
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} board={board} setBoard={setBoard} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ projectId, board, setBoard }: { projectId: string; board: Board; setBoard: (b: Board) => void }) {
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: dbNodes } = useQuery({
    queryKey: ["nodes", projectId, board],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_nodes")
        .select("*")
        .eq("project_id", projectId)
        .eq("board", board);
      if (error) throw error;
      return data;
    },
  });
  const { data: dbEdges } = useQuery({
    queryKey: ["edges", projectId, board],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_edges")
        .select("*")
        .eq("project_id", projectId)
        .eq("board", board);
      if (error) throw error;
      return data;
    },
  });

  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const [generatingFlow, setGeneratingFlow] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [logicModel, setLogicModel] = useState<string>(() => {
    if (typeof window === "undefined") return LOGIC_FLOW_MODEL_DEFAULT;
    const stored = localStorage.getItem(LOGIC_FLOW_MODEL_KEY);
    // Migrate the old "lovable" default to the new direct-OpenAI default so
    // existing users stop hitting Lovable AI credit walls unintentionally.
    if (!stored || stored === "lovable-default") return LOGIC_FLOW_MODEL_DEFAULT;
    return stored;
  });
  const posTimers = useRef<Record<string, number>>({});

  // Pick up changes made from Settings → AI provider routing → Logic Flow.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key === LOGIC_FLOW_MODEL_KEY && e.newValue) setLogicModel(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    if (!dbNodes) return;
    setNodes(
      dbNodes.map((n) => ({
        id: n.id,
        position: { x: n.position_x, y: n.position_y },
        data: { label: n.title || "(untitled)", type: n.node_type, color: n.color, description: n.description, createdByMessageId: (n as { created_by_message_id?: string | null }).created_by_message_id ?? null },
        type: "case",
        draggable: !n.locked,
      }))
    );
  }, [dbNodes, setNodes]);

  useEffect(() => {
    if (!dbEdges) return;
    setEdges(
      dbEdges.map((e) => ({
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        label: e.label ?? undefined,
        type: "smoothstep",
        animated: false,
        style: { stroke: "var(--color-accent, #6366f1)", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-accent, #6366f1)", width: 18, height: 18 },
        labelStyle: { fontSize: 11, fontWeight: 500, fill: "var(--color-foreground)" },
        labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.9 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
      }))
    );
  }, [dbEdges, setEdges]);

  useEffect(() => {
    setSummaryDraft(project?.solution_summary ?? "");
  }, [project?.solution_summary]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      for (const c of changes) {
        if (c.type === "position" && c.position && !c.dragging) {
          const id = c.id;
          if (posTimers.current[id]) window.clearTimeout(posTimers.current[id]);
          const pos = c.position;
          posTimers.current[id] = window.setTimeout(async () => {
            await supabase.from("canvas_nodes").update({ position_x: pos.x, position_y: pos.y }).eq("id", id);
          }, 300);
        }
      }
    },
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      for (const c of changes) {
        if (c.type === "remove") {
          supabase.from("canvas_edges").delete().eq("id", c.id).then(() => {});
        }
      }
    },
    [setEdges]
  );

  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const { data, error } = await supabase
        .from("canvas_edges")
        .insert({ project_id: projectId, board, source_id: conn.source, target_id: conn.target })
        .select()
        .single();
      if (error) return toast.error(error.message);
      setEdges((es) => addEdge({ id: data.id, source: conn.source!, target: conn.target! } as Edge, es));
    },
    [projectId, board, setEdges]
  );

  const addNode = async (type: string, color: string, label: string) => {
    const n = nodes.length;
    const x = 80 + (n % 5) * 220;
    const y = 80 + Math.floor(n / 5) * 140;
    const { error } = await supabase.from("canvas_nodes").insert({
      project_id: projectId, board, node_type: type, title: label, color,
      position_x: x, position_y: y,
    });
    if (error) toast.error(error.message);
  };

  const [arranging, setArranging] = useState(false);

  // Auto-arrange the current board.
  // - If there are edges, run a directed dagre layout (left→right) so
  //   connected nodes flow naturally and parents sit before children.
  // - If there are no edges (e.g. final board before documents are linked,
  //   or a fresh logic board), tile the nodes into a clean grid grouped
  //   loosely by node_type so similar nodes cluster together.
  const arrangeNodes = useCallback(async () => {
    if (arranging) return;
    if (nodes.length === 0) {
      toast.info("No nodes to arrange yet.");
      return;
    }
    setArranging(true);
    try {
      const NODE_W = 200;
      const NODE_H = 90;
      const positions = new Map<string, { x: number; y: number }>();

      if (edges.length > 0) {
        const g = new dagre.graphlib.Graph();
        g.setGraph({
          rankdir: "LR",
          nodesep: 60,
          ranksep: 120,
          marginx: 40,
          marginy: 40,
        });
        g.setDefaultEdgeLabel(() => ({}));

        for (const n of nodes) {
          g.setNode(n.id, { width: NODE_W, height: NODE_H });
        }
        for (const e of edges) {
          if (e.source && e.target) g.setEdge(e.source, e.target);
        }
        dagre.layout(g);

        for (const n of nodes) {
          const p = g.node(n.id);
          if (p) {
            // dagre returns center coords; React Flow expects top-left.
            positions.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
          }
        }
      } else {
        // Grid layout grouped by node type for a clean default look.
        const groups = new Map<string, string[]>();
        for (const n of nodes) {
          const t = (n.data as { type?: string } | undefined)?.type ?? "note";
          if (!groups.has(t)) groups.set(t, []);
          groups.get(t)!.push(n.id);
        }
        const COLS = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(nodes.length))));
        const STEP_X = NODE_W + 60;
        const STEP_Y = NODE_H + 70;
        let row = 0;
        for (const [, ids] of groups) {
          let col = 0;
          for (const id of ids) {
            positions.set(id, { x: 60 + col * STEP_X, y: 60 + row * STEP_Y });
            col += 1;
            if (col >= COLS) {
              col = 0;
              row += 1;
            }
          }
          // Move to next row when finishing a group, so groups don't bleed together.
          if (col !== 0) row += 1;
        }
      }

      // Optimistic local update so the layout snaps immediately.
      setNodes((ns) =>
        ns.map((n) => {
          const p = positions.get(n.id);
          return p ? { ...n, position: p } : n;
        }),
      );

      // Persist in parallel.
      const updates = Array.from(positions.entries()).map(([id, p]) =>
        supabase.from("canvas_nodes").update({ position_x: p.x, position_y: p.y }).eq("id", id),
      );
      const results = await Promise.all(updates);
      const failed = results.filter((r) => r.error).length;
      if (failed > 0) {
        toast.error(`Arranged, but ${failed} node${failed === 1 ? "" : "s"} failed to save position.`);
      } else {
        toast.success(
          edges.length > 0
            ? `Arranged ${nodes.length} nodes by flow.`
            : `Arranged ${nodes.length} nodes in a grid.`,
        );
      }
    } finally {
      setArranging(false);
    }
  }, [nodes, edges, arranging, setNodes]);

  const generateLogicFlow = async (opts?: { useExistingSummary?: boolean }) => {
    if (board !== "logic") {
      toast.error("Switch to the Logic Flow board first");
      return;
    }
    const approvedSummary = (project?.solution_summary ?? "").trim();
    // Default: if an approved summary exists, use it. Caller can override.
    const useExistingSummary = opts?.useExistingSummary ?? !!approvedSummary;

    if (nodes.length > 0) {
      if (!confirm("This will replace the current Logic Flow board. Continue?")) return;
    }
    if (!useExistingSummary && approvedSummary) {
      if (!confirm("This will REPLACE your approved solution summary with a freshly invented one. Continue?")) return;
    }

    setGeneratingFlow(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-logic-flow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ projectId, replace: true, modelOverride: logicModel, useExistingSummary }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: "Failed" }));
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits.");
        else toast.error(e.error ?? "Logic flow generation failed");
        return;
      }
      const data = await resp.json();
      const note = data.usedApprovedSummary ? " (using approved summary)" : "";
      toast.success(`Logic flow generated · ${data.nodeCount} nodes, ${data.edgeCount} connections${note}`);
      qc.invalidateQueries({ queryKey: ["nodes", projectId, "logic"] });
      qc.invalidateQueries({ queryKey: ["edges", projectId, "logic"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      // When we used the approved summary, preserve the textarea exactly as the user wrote it.
      if (data.usedApprovedSummary) setSummaryDraft(approvedSummary);
      setSummaryOpen(true);
    } finally {
      setGeneratingFlow(false);
    }
  };

  const approveLogic = async () => {
    if (!summaryDraft.trim()) {
      toast.error("Add a solution summary before approving");
      return;
    }
    const { error } = await supabase
      .from("projects")
      .update({
        solution_summary: summaryDraft,
        logic_approved_at: new Date().toISOString(),
        phase: "production",
      })
      .eq("id", projectId);
    if (error) return toast.error(error.message);
    toast.success("Logic approved — you can now generate documents");
    setSummaryOpen(false);
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    setBoard("final");
  };

  const approved = !!project?.logic_approved_at;

  return (
    <div className="h-full flex flex-col relative">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 flex-wrap">
        {/* Board switcher */}
        <div className="inline-flex rounded-lg border bg-card shadow-soft p-0.5">
          <button
            onClick={() => setBoard("logic")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              board === "logic" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Logic Flow
            {approved && <CheckCircle2 className="inline-block h-3 w-3 ml-1.5 text-success" />}
          </button>
          <button
            onClick={() => setBoard("final")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              board === "final" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Final
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-2 shadow-pop"><Plus className="h-4 w-4" /> Add node</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {NODE_TYPES.map((n) => (
              <DropdownMenuItem key={n.t} onClick={() => addNode(n.t, n.c, n.l)} className="gap-3">
                <span className="h-3 w-3 rounded-full" style={{ background: n.c }} />
                {n.l}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          className="gap-2 h-9"
          onClick={arrangeNodes}
          disabled={arranging || nodes.length === 0}
          title={
            edges.length > 0
              ? "Auto-arrange nodes by their connections (left → right)"
              : "Auto-arrange nodes into a clean grid (no connections yet)"
          }
        >
          {arranging ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutGrid className="h-4 w-4" />}
          Arrange
          {nodes.length > 0 && (
            <span className="ml-0.5 text-[10px] text-muted-foreground font-normal">
              · {edges.length > 0 ? "by flow" : "grid"}
            </span>
          )}
        </Button>

        {board === "logic" && (
          <>
            <Select
              value={logicModel}
              onValueChange={(v) => {
                setLogicModel(v);
                if (typeof window !== "undefined") localStorage.setItem(LOGIC_FLOW_MODEL_KEY, v);
              }}
            >
              <SelectTrigger className="h-9 text-xs w-[210px]" title="Model used to generate the logic flow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOGIC_FLOW_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {project?.solution_summary ? (
              <>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-1 text-xs text-foreground hover:bg-success/15 transition-colors"
                  title="Click to view the approved summary"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  Using approved summary
                </button>
                <div className="inline-flex rounded-md border bg-card shadow-soft overflow-hidden">
                  <Button
                    variant="ghost"
                    className="gap-2 rounded-none border-r h-9"
                    onClick={() => generateLogicFlow({ useExistingSummary: true })}
                    disabled={generatingFlow}
                  >
                    {generatingFlow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {nodes.length === 0 ? "Generate from approved summary" : "Re-generate from summary"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="rounded-none px-2 h-9" disabled={generatingFlow} title="More generation options">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuItem
                        onClick={() => generateLogicFlow({ useExistingSummary: false })}
                        className="gap-2 items-start"
                      >
                        <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">Generate fresh (ignore summary)</span>
                          <span className="text-xs text-muted-foreground">Replaces your approved solution summary with a new one.</span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            ) : (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => generateLogicFlow()}
                disabled={generatingFlow}
                title="Tip: approve a Phase 2 summary in the Assistant first for a flow that matches your narrative."
              >
                {generatingFlow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {nodes.length === 0 ? "Generate logic flow" : "Re-generate"}
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={() => setSummaryOpen(true)}>
              <ScrollText className="h-4 w-4" /> Solution summary
              {project?.solution_summary ? (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-success"
                  title="A solution summary is saved (visible to the assistant + document generator)"
                />
              ) : null}
            </Button>
          </>
        )}
      </div>

      {board === "logic" && !approved && (
        <div className="absolute top-4 right-4 z-10 max-w-sm">
          <div className="bg-warning/10 border border-warning/30 text-foreground rounded-lg px-3 py-2 text-xs shadow-soft">
            <strong className="font-medium">Pre-step:</strong> design the case logic and approve a solution summary before generating documents.
          </div>
        </div>
      )}

      {board === "final" && !approved && (
        <div className="absolute top-4 right-4 z-10 max-w-sm">
          <div className="bg-muted border rounded-lg px-3 py-2 text-xs shadow-soft text-muted-foreground">
            Logic flow not yet approved. Approve it to lock the case design before producing the final board.
          </div>
        </div>
      )}

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={caseNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_e, n: RFNode) => setSelectedNodeId(n.id)}
          fitView
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "var(--color-accent, #6366f1)", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-accent, #6366f1)", width: 18, height: 18 },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.4}
            color="color-mix(in oklab, var(--color-muted-foreground) 35%, transparent)"
          />
          <MiniMap
            pannable
            zoomable
            maskColor="color-mix(in oklab, var(--color-background) 70%, transparent)"
            nodeColor={(n) => {
              const t = (n.data as { type?: string } | undefined)?.type;
              return getNodeMeta(t).accent;
            }}
            nodeStrokeWidth={2}
            nodeBorderRadius={6}
          />
          <Controls />
        </ReactFlow>
      </div>

      <NodeDetailPanel
        nodeId={selectedNodeId}
        projectId={projectId}
        modelOverride={logicModel}
        board={board}
        onClose={() => setSelectedNodeId(null)}
      />

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Solution summary</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            How does the player solve this case? This is your single source of truth — the assistant and document generator will follow it.
          </p>
          <Textarea
            rows={14}
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            placeholder="Paragraph 1: the setup. Paragraph 2: which clues lead where. Paragraph 3: which red herrings mislead and why. Paragraph 4: the deduction chain. Paragraph 5: the final reveal."
            className="font-mono text-xs leading-relaxed"
          />
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await supabase.from("projects").update({ solution_summary: summaryDraft }).eq("id", projectId);
                toast.success("Summary saved");
                qc.invalidateQueries({ queryKey: ["project", projectId] });
              }}
            >
              Save draft
            </Button>
            <Button className="gap-2" onClick={approveLogic}>
              <CheckCircle2 className="h-4 w-4" />
              {approved ? "Re-approve & continue" : "Approve & start producing documents"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Side panel that opens when a canvas node is clicked.
// Shows the node's metadata, any linked documents/suspects, and an
// AI-generated explanation of the node's role in the case (on-demand).
function NodeDetailPanel({
  nodeId,
  projectId,
  modelOverride,
  board,
  onClose,
}: {
  nodeId: string | null;
  projectId: string;
  modelOverride: string;
  board: Board;
  onClose: () => void;
}) {
  const open = nodeId !== null;
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const autoExplained = useRef<Set<string>>(new Set());

  const { data: node } = useQuery({
    queryKey: ["canvas-node", nodeId],
    enabled: !!nodeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_nodes")
        .select("*")
        .eq("id", nodeId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: linkedDocs = [] } = useQuery({
    queryKey: ["canvas-node-docs", nodeId],
    enabled: !!nodeId && board === "final",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, doc_number, doc_type")
        .eq("project_id", projectId)
        .contains("linked_node_ids", [nodeId!]);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: linkedSuspects = [] } = useQuery({
    queryKey: ["canvas-node-suspects", nodeId, linkedDocs.map((d) => d.id).join(",")],
    enabled: !!nodeId && linkedDocs.length > 0,
    queryFn: async () => {
      const { data: docs } = await supabase
        .from("documents")
        .select("linked_suspect_ids")
        .in("id", linkedDocs.map((d) => d.id));
      const ids = new Set<string>();
      (docs ?? []).forEach((d) =>
        (d.linked_suspect_ids ?? []).forEach((s: string) => ids.add(s)),
      );
      if (!ids.size) return [];
      const { data: sus } = await supabase
        .from("suspects")
        .select("id, name")
        .in("id", [...ids]);
      return sus ?? [];
    },
  });

  const explain = useCallback(async () => {
    if (!nodeId) return;
    setExplaining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/explain-canvas-node`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ nodeId, modelOverride }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: "Failed" }));
        toast.error(e.error ?? "Could not generate explanation");
        return;
      }
      const data = await resp.json();
      setExplanation(data.explanation ?? "");
    } finally {
      setExplaining(false);
    }
  }, [nodeId, modelOverride]);

  useEffect(() => {
    setExplanation(null);
    if (nodeId && !autoExplained.current.has(nodeId)) {
      autoExplained.current.add(nodeId);
      explain();
    }
  }, [nodeId, explain]);

  const jumpToDocuments = (docId?: string) => {
    window.dispatchEvent(
      new CustomEvent("mystudio:navigate", {
        detail: { tab: "documents", targetId: docId },
      }),
    );
  };

  const jumpToSuspects = (suspectId?: string) => {
    window.dispatchEvent(
      new CustomEvent("mystudio:navigate", {
        detail: { tab: "suspects", targetId: suspectId },
      }),
    );
  };

  const meta = getNodeMeta(node?.node_type);
  const accent = node?.color || meta.accent;
  const Icon = meta.icon;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 overflow-hidden flex flex-col gap-0 border-l"
      >
        {/* Hero header — colored band, icon chip, title, close */}
        <div
          className="relative px-6 pt-6 pb-5"
          style={{
            background: `linear-gradient(135deg, color-mix(in oklab, ${accent} 16%, var(--color-card)) 0%, var(--color-card) 100%)`,
            borderBottom: `1px solid color-mix(in oklab, ${accent} 25%, var(--color-border))`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full bg-card/80 backdrop-blur border text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-start gap-3 pr-8">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
              style={{
                background: accent,
                color: "white",
                boxShadow: `0 6px 18px -6px color-mix(in oklab, ${accent} 60%, transparent)`,
              }}
            >
              <Icon className="h-5 w-5" strokeWidth={2.4} />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-1"
                style={{ color: `color-mix(in oklab, ${accent} 70%, var(--color-foreground))` }}
              >
                {meta.label}
              </div>
              <h2 className="font-display text-[22px] leading-tight text-foreground">
                {node?.title || "Loading…"}
              </h2>
            </div>
          </div>

          {board === "final" && (
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Stat label="Documents" value={linkedDocs.length} />
              <Stat label="Suspects" value={linkedSuspects.length} />
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {node?.description && (
            <PanelSection title="Description">
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                {node.description}
              </p>
            </PanelSection>
          )}

          <PanelSection
            title="AI explanation"
            action={
              <Button
                size="sm"
                variant={explanation ? "outline" : "default"}
                className="gap-1.5 h-7 text-xs"
                onClick={explain}
                disabled={explaining}
              >
                {explaining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {explanation ? "Regenerate" : "Explain"}
              </Button>
            }
          >
            {explanation ? (
              <div
                className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90 rounded-lg p-3.5"
                style={{
                  background: `color-mix(in oklab, ${accent} 6%, var(--color-muted))`,
                  border: `1px solid color-mix(in oklab, ${accent} 18%, var(--color-border))`,
                }}
              >
                {explanation}
              </div>
            ) : explaining ? (
              <div
                className="text-xs text-muted-foreground leading-relaxed rounded-lg p-3.5 flex items-center gap-2"
                style={{
                  background: `color-mix(in oklab, ${accent} 6%, var(--color-muted))`,
                  border: `1px solid color-mix(in oklab, ${accent} 18%, var(--color-border))`,
                }}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                Generating explanation…
              </div>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Click <em>Explain</em> for an AI breakdown of what this node does and how it fits into the
                overall solution. Uses your current Logic Flow model.
              </p>
            )}
          </PanelSection>

          <PanelSection title={`Linked documents · ${linkedDocs.length}`}>
            {linkedDocs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No documents are linked to this node yet. Link them from the Documents tab.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {linkedDocs.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => jumpToDocuments(d.id)}
                      className="group w-full text-left flex items-center gap-2.5 rounded-lg border bg-card hover:bg-muted/60 hover:border-foreground/20 transition-colors px-3 py-2.5 text-sm"
                    >
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted shrink-0">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <span className="truncate flex-1 font-medium">
                        {d.doc_number != null ? (
                          <span className="text-muted-foreground mr-1.5 font-normal">#{d.doc_number}</span>
                        ) : null}
                        {d.title}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>

          {linkedSuspects.length > 0 && (
            <PanelSection title="Suspects in linked documents">
              <div className="flex flex-wrap gap-1.5">
                {linkedSuspects.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jumpToSuspects(s.id)}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card hover:bg-muted hover:border-foreground/20 px-3 py-1 text-[11px] font-medium transition-colors"
                  >
                    {s.name}
                    <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                  </button>
                ))}
              </div>
            </PanelSection>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card/70 backdrop-blur px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-lg font-display leading-none mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

function PanelSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

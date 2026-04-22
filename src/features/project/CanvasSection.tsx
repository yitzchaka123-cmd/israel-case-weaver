import { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
  Background, Controls, MiniMap, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type NodeChange, type EdgeChange,
  applyNodeChanges, applyEdgeChanges, ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Wand2, CheckCircle2, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Board = "logic" | "final";

const NODE_TYPES = [
  { t: "clue", l: "Clue", c: "oklch(0.68 0.15 155)" },
  { t: "suspect", l: "Suspect", c: "oklch(0.62 0.2 30)" },
  { t: "deduction", l: "Deduction", c: "oklch(0.65 0.18 285)" },
  { t: "contradiction", l: "Contradiction", c: "oklch(0.58 0.22 27)" },
  { t: "red_herring", l: "Red Herring", c: "oklch(0.78 0.16 75)" },
  { t: "envelope", l: "Envelope", c: "oklch(0.55 0.18 220)" },
  { t: "document", l: "Document", c: "oklch(0.5 0.05 260)" },
  { t: "solution", l: "Final Solution", c: "oklch(0.45 0.15 285)" },
  { t: "note", l: "Note", c: "oklch(0.7 0.02 260)" },
];

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
  const posTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!dbNodes) return;
    setNodes(
      dbNodes.map((n) => ({
        id: n.id,
        position: { x: n.position_x, y: n.position_y },
        data: { label: n.title || "(untitled)", type: n.node_type, color: n.color, description: n.description },
        type: "default",
        draggable: !n.locked,
        style: {
          background: "var(--color-card)",
          border: `2px solid ${n.color ?? "var(--color-border)"}`,
          borderRadius: 12,
          padding: "10px 14px",
          minWidth: 160,
          boxShadow: "var(--shadow-md)",
          color: "var(--color-foreground)",
          fontSize: 13,
        },
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
        animated: false,
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

  const generateLogicFlow = async () => {
    if (board !== "logic") {
      toast.error("Switch to the Logic Flow board first");
      return;
    }
    if (nodes.length > 0) {
      if (!confirm("This will replace the current Logic Flow board. Continue?")) return;
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
        body: JSON.stringify({ projectId, replace: true }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: "Failed" }));
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits.");
        else toast.error(e.error ?? "Logic flow generation failed");
        return;
      }
      const data = await resp.json();
      toast.success(`Logic flow generated · ${data.nodeCount} nodes, ${data.edgeCount} connections`);
      qc.invalidateQueries({ queryKey: ["nodes", projectId, "logic"] });
      qc.invalidateQueries({ queryKey: ["edges", projectId, "logic"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
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

        {board === "logic" && (
          <>
            <Button variant="outline" className="gap-2" onClick={generateLogicFlow} disabled={generatingFlow}>
              {generatingFlow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {nodes.length === 0 ? "Generate logic flow" : "Re-generate"}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setSummaryOpen(true)}>
              <ScrollText className="h-4 w-4" /> Solution summary
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
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="var(--color-border)" />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>

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

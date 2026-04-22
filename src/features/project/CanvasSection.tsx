import { useCallback, useEffect, useMemo, useRef } from "react";
import ReactFlow, {
  Background, Controls, MiniMap, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeChange, type EdgeChange,
  applyNodeChanges, applyEdgeChanges, ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import { toast } from "sonner";

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
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ projectId }: { projectId: string }) {
  const { data: dbNodes } = useQuery({
    queryKey: ["nodes", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("canvas_nodes").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data;
    },
  });
  const { data: dbEdges } = useQuery({
    queryKey: ["edges", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("canvas_edges").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data;
    },
  });

  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      // Persist position changes (debounced per-node)
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
        .insert({ project_id: projectId, source_id: conn.source, target_id: conn.target })
        .select()
        .single();
      if (error) return toast.error(error.message);
      setEdges((es) => addEdge({ id: data.id, source: conn.source!, target: conn.target! } as Edge, es));
    },
    [projectId, setEdges]
  );

  const addNode = async (type: string, color: string, label: string) => {
    // Place at a reasonable spot based on existing count
    const n = nodes.length;
    const x = 80 + (n % 5) * 220;
    const y = 80 + Math.floor(n / 5) * 140;
    const { error } = await supabase.from("canvas_nodes").insert({
      project_id: projectId, node_type: type, title: label, color,
      position_x: x, position_y: y,
    });
    if (error) toast.error(error.message);
  };

  return (
    <div className="h-full flex flex-col relative">
      <div className="absolute top-4 left-4 z-10 flex gap-2">
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
      </div>
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
    </div>
  );
}

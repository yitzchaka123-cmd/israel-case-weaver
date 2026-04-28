// Tracks both:
//   - "live" growth: a new canvas_node/edge just landed (covers the streaming
//     phase, when nodes are flowing in one-by-one).
//   - "building": the project's `logic_flow_building_at` is set (covers the
//     pre-stream planning phase, when the model is still thinking and no
//     node has landed yet — typically 30–90s).
//
// Either signal lights up the green "Drawing live…" / "Planning…" indicators
// on the Case Board tab and Canvas toolbar.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LIVE_WINDOW_MS = 12_000;

export interface LogicFlowLiveState {
  isLive: boolean; // a node/edge landed recently (streaming)
  isBuilding: boolean; // project flag says generation is in-flight
  // Convenience: "show some indicator" — true when either is on.
  isActive: boolean;
}

export function useLogicFlowLive(projectId: string): LogicFlowLiveState {
  const [grewAt, setGrewAt] = useState<number>(0);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const [buildingAt, setBuildingAt] = useState<string | null>(null);

  // Initial load of the building flag (in case generation already started
  // before this hook mounted).
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("projects")
      .select("logic_flow_building_at")
      .eq("id", projectId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setBuildingAt(
          (data as { logic_flow_building_at?: string | null } | null)?.logic_flow_building_at ??
            null,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    // Unique per-mount suffix prevents StrictMode double-mount (and rapid
    // remounts) from grabbing the same already-subscribed channel and
    // throwing "cannot add postgres_changes callbacks after subscribe()".
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(`logic-flow-live-${projectId}-${uniqueSuffix}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "canvas_nodes", filter: `project_id=eq.${projectId}` },
        (payload) => {
          // Count both Logic Flow and Final Flow inserts as "live drawing" —
          // both are AI-streamed boards the user wants to watch in real time.
          const board = (payload.new as { board?: string } | null)?.board;
          if (board === "logic" || board === "final") setGrewAt(Date.now());
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "canvas_edges", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const board = (payload.new as { board?: string } | null)?.board;
          if (board === "logic" || board === "final") setGrewAt(Date.now());
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${projectId}` },
        (payload) => {
          const next = (payload.new as { logic_flow_building_at?: string | null } | null)
            ?.logic_flow_building_at;
          setBuildingAt(next ?? null);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const isLive = nowTs - grewAt < LIVE_WINDOW_MS && grewAt > 0;
  const isBuilding = !!buildingAt;
  const isActive = isLive || isBuilding;

  // Tick `nowTs` only while live so we naturally extinguish the dot
  // ~LIVE_WINDOW_MS after the last node lands.
  useEffect(() => {
    if (!isLive) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [isLive]);

  return { isLive, isBuilding, isActive };
}

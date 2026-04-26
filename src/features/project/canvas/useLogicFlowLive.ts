// Tracks whether either case board (Logic or Final) is being actively streamed
// by the AI.
//
// We listen to realtime INSERT events on canvas_nodes / canvas_edges for this
// project and flip on a "live growth" window the instant a new row lands —
// no debounced count refetch. This drives the green "live" dot on the Case
// Board tab and the "Drawing live…" pill on the canvas toolbar, so the moment
// the AI starts streaming either board, the dot lights up.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LIVE_WINDOW_MS = 12_000;

export function useLogicFlowLive(projectId: string): boolean {
  const [grewAt, setGrewAt] = useState<number>(0);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  useEffect(() => {
    const channel = supabase
      .channel(`logic-flow-live-${projectId}`)
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const isLive = nowTs - grewAt < LIVE_WINDOW_MS && grewAt > 0;

  // Tick `nowTs` only while live so we naturally extinguish the dot
  // ~LIVE_WINDOW_MS after the last node lands.
  useEffect(() => {
    if (!isLive) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [isLive]);

  return isLive;
}

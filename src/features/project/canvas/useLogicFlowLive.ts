// Tracks whether the Logic Flow board is being actively streamed by the AI.
//
// We watch the `canvas_nodes` row count for the project's logic board via
// a realtime subscription and flag a "live growth" window whenever the
// count increases. Exposed as a shared hook so both the canvas toolbar
// and the parent workspace tab strip can show a live indicator.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LIVE_WINDOW_MS = 8_000;

export function useLogicFlowLive(projectId: string): boolean {
  const lastCountRef = useRef<number>(0);
  const initialRef = useRef<boolean>(true);
  const [grewAt, setGrewAt] = useState<number>(0);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  // Refetch the count whenever a row changes for this project's logic board.
  useEffect(() => {
    let cancelled = false;
    const refetch = async () => {
      const { count, error } = await supabase
        .from("canvas_nodes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("board", "logic");
      if (cancelled || error) return;
      const next = count ?? 0;
      if (initialRef.current) {
        initialRef.current = false;
        lastCountRef.current = next;
        return;
      }
      if (next > lastCountRef.current) setGrewAt(Date.now());
      lastCountRef.current = next;
    };

    refetch();

    const channel = supabase
      .channel(`logic-flow-live-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "canvas_nodes", filter: `project_id=eq.${projectId}` },
        () => { void refetch(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const isLive = nowTs - grewAt < LIVE_WINDOW_MS && grewAt > 0;

  useEffect(() => {
    if (!isLive) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [isLive]);

  return isLive;
}

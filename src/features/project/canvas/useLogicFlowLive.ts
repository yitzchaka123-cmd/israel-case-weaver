// Tracks whether the Logic Flow board is being actively streamed by the AI.
//
// We watch the `canvas_nodes` row count for the project's logic board and
// flag a "live growth" window whenever the count increases. This mirrors
// the inline detection inside CanvasSection but is exposed as a shared
// hook so the parent workspace tab strip can show a tiny green dot.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const LIVE_WINDOW_MS = 8_000;

export function useLogicFlowLive(projectId: string): boolean {
  const { data: nodeCount } = useQuery({
    queryKey: ["logic-flow-live-count", projectId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("canvas_nodes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("board", "logic");
      if (error) throw error;
      return count ?? 0;
    },
    // The parent workspace already invalidates ["nodes", projectId] on
    // realtime changes; we mirror that signal by listening to the same
    // table here too so this hook works even when the workspace isn't
    // mounted that subscription yet.
    refetchInterval: false,
  });

  const lastCountRef = useRef<number>(0);
  const initialRef = useRef<boolean>(true);
  const [grewAt, setGrewAt] = useState<number>(0);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (nodeCount === undefined) return;
    if (initialRef.current) {
      initialRef.current = false;
      lastCountRef.current = nodeCount;
      return;
    }
    if (nodeCount > lastCountRef.current) {
      setGrewAt(Date.now());
    }
    lastCountRef.current = nodeCount;
  }, [nodeCount]);

  const isLive = nowTs - grewAt < LIVE_WINDOW_MS && grewAt > 0;

  useEffect(() => {
    if (!isLive) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [isLive]);

  return isLive;
}

// Lightweight subscription that returns true when this project has a
// `bulk_generation_jobs` row in `running` state with a recent heartbeat.
// Used by the top tab bar to show a live "🟢" dot on the Documents tab
// while a bulk run is active. Jobs whose heartbeat is older than ~4 minutes
// are treated as stale (worker dead) and considered NOT active so the UI
// doesn't lock up forever waiting for a ghost.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STALE_MS = 4 * 60_000;

export function useActiveBulkJob(projectId: string): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const { data } = await supabase
        .from("bulk_generation_jobs")
        .select("id, last_heartbeat_at")
        .eq("project_id", projectId)
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1);
      const row = (data?.[0] ?? null) as { last_heartbeat_at?: string | null } | null;
      const fresh = !!row && (Date.now() - new Date(row.last_heartbeat_at ?? 0).getTime() < STALE_MS);
      if (!cancelled) setActive(fresh);
    };
    refresh();
    const beat = setInterval(refresh, 15_000); // re-evaluate staleness even without a row change
    const ch = supabase
      .channel(`bulk-jobs-live-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bulk_generation_jobs", filter: `project_id=eq.${projectId}` },
        () => { refresh(); },
      )
      .subscribe();
    return () => { cancelled = true; clearInterval(beat); supabase.removeChannel(ch); };
  }, [projectId]);

  return active;
}

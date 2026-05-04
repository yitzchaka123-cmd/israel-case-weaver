// Lightweight subscription that returns true when this project has a
// `bulk_generation_jobs` row in `running` state with a recent heartbeat.
// Used by the top tab bar to show a live "🟢" dot on the Documents tab
// while a bulk run is active. Jobs whose heartbeat is older than ~4 minutes
// are treated as stale (worker dead) — we auto-sweep them via RPC and
// notify the user so the UI doesn't lock up forever waiting for a ghost.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STALE_MS = 4 * 60_000;
const STALE_MINUTES = 4;

export function useActiveBulkJob(projectId: string): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sweptIds = new Set<string>();

    const sweepAndNotify = async (row: {
      id: string;
      total?: number | null;
      completed?: number | null;
      failed?: number | null;
    }) => {
      if (sweptIds.has(row.id)) return;
      sweptIds.add(row.id);
      try {
        const { data: count, error } = await supabase.rpc("sweep_stale_bulk_jobs", {
          p_project_id: projectId,
          p_stale_minutes: STALE_MINUTES,
        });
        if (error) throw error;
        if (!count || (count as number) === 0) return;
        const completed = row.completed ?? 0;
        const total = row.total ?? 0;
        const failed = row.failed ?? 0;
        await supabase.from("project_notifications").insert({
          project_id: projectId,
          kind: "bulk_job_stalled",
          title: `Drafting stopped at ${completed}/${total}`,
          body: `The worker stopped responding. ${failed} failed, ${completed} completed. You can resume drafting the remaining documents.`,
          starter_prompt: "Resume drafting the remaining documents in this project.",
          created_by: "assistant",
          status: "unread",
        });
      } catch (e) {
        console.warn("[bulk] auto-sweep failed", e);
      }
    };

    const refresh = async () => {
      const { data } = await supabase
        .from("bulk_generation_jobs")
        .select("id, last_heartbeat_at, total, completed, failed")
        .eq("project_id", projectId)
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1);
      const row = (data?.[0] ?? null) as
        | { id: string; last_heartbeat_at?: string | null; total?: number | null; completed?: number | null; failed?: number | null }
        | null;
      const fresh = !!row && (Date.now() - new Date(row.last_heartbeat_at ?? 0).getTime() < STALE_MS);
      if (!cancelled) setActive(fresh);
      if (row && !fresh) {
        await sweepAndNotify(row);
      }
    };
    refresh();
    const beat = setInterval(refresh, 15_000);
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

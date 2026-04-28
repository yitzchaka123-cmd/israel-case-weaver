// Tracks a batch of media_assets jobs by id and reports live progress
// (pending / generated / failed) using realtime updates.
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BatchJobState {
  id: string;
  status: "pending" | "generated" | "failed";
}

export interface BatchProgress {
  total: number;
  done: number;
  failed: number;
  pending: number;
  active: boolean;
  label: string | null;
  jobs: BatchJobState[];
}

export function useBatchImageProgress(projectId: string) {
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, BatchJobState>>({});
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback((ids: string[], batchLabel: string) => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setJobIds(ids);
    setLabel(batchLabel);
    setJobs(Object.fromEntries(ids.map((id) => [id, { id, status: "pending" as const }])));
  }, []);

  // Initial fetch in case rows already advanced before subscription opened.
  useEffect(() => {
    if (jobIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("media_assets")
        .select("id,status")
        .in("id", jobIds);
      if (cancelled || !data) return;
      setJobs((prev) => {
        const next = { ...prev };
        for (const row of data) {
          const status = row.status === "generated" || row.status === "failed" ? row.status : "pending";
          next[row.id] = { id: row.id, status };
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [jobIds]);

  // Realtime subscription for the active batch.
  useEffect(() => {
    if (jobIds.length === 0) return;
    const ch = supabase
      .channel(`batch-progress-${projectId}-${jobIds[0]}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          if (!jobIds.includes(row.id)) return;
          const status = row.status === "generated" || row.status === "failed" ? row.status : "pending";
          setJobs((prev) => ({ ...prev, [row.id]: { id: row.id, status } }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [jobIds, projectId]);

  const list = Object.values(jobs);
  const done = list.filter((j) => j.status === "generated").length;
  const failed = list.filter((j) => j.status === "failed").length;
  const pending = list.filter((j) => j.status === "pending").length;
  const total = list.length;
  const active = total > 0 && pending > 0;

  // Auto-clear 8s after the batch finishes.
  useEffect(() => {
    if (total === 0 || pending > 0) return;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      setJobIds([]);
      setJobs({});
      setLabel(null);
    }, 8000);
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, [pending, total]);

  return {
    progress: { total, done, failed, pending, active, label, jobs: list } satisfies BatchProgress,
    start,
  };
}

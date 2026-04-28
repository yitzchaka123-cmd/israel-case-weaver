// Tracks a batch of media_assets jobs by id and reports live progress
// (pending / generated / failed) using realtime updates.
//
// Slots accept either a real media_assets row id (will be flipped to
// "generated" / "failed" via realtime) or a "pseudo id" for jobs whose
// kicker call failed before any DB row was created — those start in the
// "failed" state immediately so the denominator stays honest.
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BatchJobSlot {
  /** Either real media_assets id or a "kick-failed-..." pseudo id. */
  id: string;
  /** Optional human label (e.g. "Box side 2"). */
  label?: string;
  /** True when the kick-off call failed before INSERT — start as "failed". */
  kickFailed?: boolean;
}

export interface BatchJobState {
  id: string;
  status: "pending" | "generated" | "failed";
  label?: string;
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

  const start = useCallback((slots: BatchJobSlot[], batchLabel: string) => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setJobIds(slots.map((s) => s.id));
    setLabel(batchLabel);
    setJobs(Object.fromEntries(slots.map((s) => [
      s.id,
      { id: s.id, label: s.label, status: s.kickFailed ? "failed" as const : "pending" as const },
    ])));
  }, []);

  const dismiss = useCallback(() => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setJobIds([]);
    setJobs({});
    setLabel(null);
  }, []);

  // Initial fetch in case rows already advanced before subscription opened.
  useEffect(() => {
    if (jobIds.length === 0) return;
    const realIds = jobIds.filter((id) => !id.startsWith("kick-failed-"));
    if (realIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("media_assets")
        .select("id,status")
        .in("id", realIds);
      if (cancelled || !data) return;
      setJobs((prev) => {
        const next = { ...prev };
        for (const row of data) {
          const status = row.status === "generated" || row.status === "failed" ? row.status : "pending";
          next[row.id] = { ...next[row.id], id: row.id, status };
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [jobIds]);

  // Realtime subscription for the active batch.
  useEffect(() => {
    if (jobIds.length === 0) return;
    const realIds = new Set(jobIds.filter((id) => !id.startsWith("kick-failed-")));
    if (realIds.size === 0) return;
    const ch = supabase
      .channel(`batch-progress-${projectId}-${jobIds[0]}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          if (!realIds.has(row.id)) return;
          const status = row.status === "generated" || row.status === "failed" ? row.status : "pending";
          setJobs((prev) => ({ ...prev, [row.id]: { ...prev[row.id], id: row.id, status } }));
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

  // Auto-clear 8s after the batch finishes, ONLY if everything succeeded.
  // If anything failed, leave it on screen until the user dismisses it so
  // they actually notice and can act.
  useEffect(() => {
    if (total === 0 || pending > 0) return;
    if (failed > 0) return; // require manual dismiss
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      setJobIds([]);
      setJobs({});
      setLabel(null);
    }, 8000);
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, [pending, total, failed]);

  return {
    progress: { total, done, failed, pending, active, label, jobs: list } satisfies BatchProgress,
    start,
    dismiss,
  };
}

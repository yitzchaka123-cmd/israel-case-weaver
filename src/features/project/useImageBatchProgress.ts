// Generic batch progress for image_generations rows (suspect portraits,
// envelope covers, hint sheets, etc). Mirrors the marketing-side
// useBatchImageProgress but tracks the `image_generations` table instead of
// `media_assets`.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ImgBatchSlot {
  id: string;
  label?: string;
  /** True when the kickoff failed before INSERT — counted as failed up-front. */
  kickFailed?: boolean;
}

export interface ImgBatchJobState {
  id: string;
  status: "pending" | "done" | "failed";
  label?: string;
}

export interface ImgBatchProgress {
  total: number;
  done: number;
  failed: number;
  pending: number;
  active: boolean;
  label: string | null;
  jobs: ImgBatchJobState[];
}

export function useImageBatchProgress(projectId: string) {
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, ImgBatchJobState>>({});
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback((slots: ImgBatchSlot[], batchLabel: string) => {
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
    setJobIds([]); setJobs({}); setLabel(null);
  }, []);

  // Initial fetch in case some rows already finished before subscribe.
  useEffect(() => {
    if (jobIds.length === 0) return;
    const realIds = jobIds.filter((id) => !id.startsWith("kick-failed-"));
    if (realIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("image_generations")
        .select("id,status")
        .in("id", realIds);
      if (cancelled || !data) return;
      setJobs((prev) => {
        const next = { ...prev };
        for (const row of data) {
          const status = row.status === "done" || row.status === "error" ? (row.status === "done" ? "done" : "failed") : "pending";
          next[row.id] = { ...next[row.id], id: row.id, status };
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [jobIds]);

  // Realtime: image_generations rows for this project.
  useEffect(() => {
    if (jobIds.length === 0) return;
    const realIds = new Set(jobIds.filter((id) => !id.startsWith("kick-failed-")));
    if (realIds.size === 0) return;
    const ch = supabase
      .channel(`img-batch-${projectId}-${jobIds[0]}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "image_generations", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          if (!realIds.has(row.id)) return;
          const status = row.status === "done" ? "done" as const : row.status === "error" ? "failed" as const : "pending" as const;
          setJobs((prev) => ({ ...prev, [row.id]: { ...prev[row.id], id: row.id, status } }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [jobIds, projectId]);

  const list = Object.values(jobs);
  const done = list.filter((j) => j.status === "done").length;
  const failed = list.filter((j) => j.status === "failed").length;
  const pending = list.filter((j) => j.status === "pending").length;
  const total = list.length;
  const active = total > 0 && pending > 0;

  // Auto-clear 8s after success; require manual dismiss when failures exist.
  useEffect(() => {
    if (total === 0 || pending > 0) return;
    if (failed > 0) return;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      setJobIds([]); setJobs({}); setLabel(null);
    }, 8000);
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, [pending, total, failed]);

  return {
    progress: { total, done, failed, pending, active, label, jobs: list } satisfies ImgBatchProgress,
    start,
    dismiss,
  };
}

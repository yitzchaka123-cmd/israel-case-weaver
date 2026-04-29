// Lightweight subscription that returns true when this project has a
// `bulk_generation_jobs` row in `running` state. Used by the top tab bar
// to show a live "🟢" dot on the Documents tab while a bulk run is active.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useActiveBulkJob(projectId: string): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const { data } = await supabase
        .from("bulk_generation_jobs")
        .select("id")
        .eq("project_id", projectId)
        .eq("status", "running")
        .limit(1);
      if (!cancelled) setActive((data?.length ?? 0) > 0);
    };
    refresh();
    const ch = supabase
      .channel(`bulk-jobs-live-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bulk_generation_jobs", filter: `project_id=eq.${projectId}` },
        () => { refresh(); },
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [projectId]);

  return active;
}

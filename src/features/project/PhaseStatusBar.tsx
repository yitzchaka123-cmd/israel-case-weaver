import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const PHASES: { key: string; label: string; short: string }[] = [
  { key: "setup", label: "Setup", short: "Setup" },
  { key: "summary", label: "Summary", short: "Sum" },
  { key: "logic", label: "Logic Flow", short: "Logic" },
  { key: "documents", label: "Documents", short: "Docs" },
  { key: "envelopes", label: "Envelopes", short: "Env" },
  { key: "hints", label: "Hints", short: "Hints" },
  { key: "packaging", label: "Packaging", short: "Pack" },
  { key: "done", label: "Done", short: "Done" },
];

// Map legacy / unknown phase values to the new canonical ones.
function normalizePhase(phase: string | null | undefined): string {
  if (!phase) return "setup";
  if (phase === "production") return "documents";
  // Legacy "structure" phase now maps to the more descriptive "logic" step.
  if (phase === "structure") return "logic";
  return PHASES.find((p) => p.key === phase) ? phase : "setup";
}

const TAB_FOR_PHASE: Record<string, string> = {
  setup: "overview",
  summary: "canvas",
  logic: "canvas",
  documents: "documents",
  envelopes: "envelopes",
  hints: "hints",
  packaging: "overview",
  done: "overview",
};

export function PhaseStatusBar({
  projectId,
  phase,
  targetDocCount,
  onJump,
}: {
  projectId: string;
  phase: string | null | undefined;
  targetDocCount: number | null;
  onJump: (tab: string) => void;
}) {
  // Pull the two derivable signals (summary text + logic approval timestamp)
  // so Summary and Logic Flow can advance independently of the server-side
  // `phase` column, which can lag behind reality.
  const { data: projectMeta } = useQuery({
    queryKey: ["phase-bar-project-meta", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("solution_summary, logic_approved_at")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as { solution_summary: string | null; logic_approved_at: string | null };
    },
  });
  const summaryDone = !!projectMeta?.solution_summary?.trim();
  const logicApproved = !!projectMeta?.logic_approved_at;

  // Lightweight counts for tooltips. Reuses the realtime invalidation already
  // wired in ProjectWorkspace via the same query keys.
  const { data: counts } = useQuery({
    queryKey: ["phase-bar-counts", projectId],
    queryFn: async () => {
      const [docs, suspects, nodes, envs, hints] = await Promise.all([
        supabase.from("documents").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("suspects").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("canvas_nodes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("envelopes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("hints").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      ]);
      return {
        documents: docs.count ?? 0,
        suspects: suspects.count ?? 0,
        nodes: nodes.count ?? 0,
        envelopes: envs.count ?? 0,
        hints: hints.count ?? 0,
      };
    },
  });
  const logicNodeCount = counts?.nodes ?? 0;

  // Derive an effective progression that reflects the actual data, not just
  // the server-side `phase` column. Summary advances as soon as it's saved;
  // Logic Flow advances as soon as it's approved. Critically, if approval is
  // CLEARED (e.g. user rewrote the summary), we also pull the bar BACK so it
  // never lies about progress that no longer exists.
  const serverIdx = PHASES.findIndex((p) => p.key === normalizePhase(phase));
  const summaryIdx = PHASES.findIndex((p) => p.key === "summary");
  const logicIdx = PHASES.findIndex((p) => p.key === "logic");
  const documentsIdx = PHASES.findIndex((p) => p.key === "documents");
  let derivedIdx = serverIdx;
  if (summaryDone && derivedIdx < logicIdx) derivedIdx = logicIdx;
  if (logicApproved && derivedIdx < documentsIdx) derivedIdx = documentsIdx;
  let currentIdx = Math.max(serverIdx, derivedIdx);
  // Caps so the bar can move BACKWARDS when data is invalidated.
  if (!summaryDone) {
    currentIdx = Math.min(currentIdx, summaryIdx);
  } else if (!logicApproved) {
    // The server snaps `phase` back to "summary" when the assistant rewrites
    // the summary (because the prior logic flow was wiped). Honor that signal
    // — if the server says we're back at Summary AND nothing has been approved
    // since, show Summary as the current step.
    const cap = normalizePhase(phase) === "summary" ? summaryIdx : logicIdx;
    currentIdx = Math.min(currentIdx, cap);
  }

  const tooltipFor = (key: string): string => {
    switch (key) {
      case "setup": return "Setup · case identity & brief";
      case "summary":
        return summaryDone ? "Summary · saved" : "Summary · not yet saved";
      case "logic":
        if (logicApproved) return `Logic Flow · approved (${logicNodeCount} nodes)`;
        if (logicNodeCount > 0) return `Logic Flow · ${logicNodeCount} nodes, awaiting approval`;
        return "Logic Flow · not yet generated";
      case "documents": return `Documents · ${counts?.documents ?? 0}${targetDocCount ? ` / ${targetDocCount}` : ""}`;
      case "envelopes": return `Envelopes · ${counts?.envelopes ?? 0}`;
      case "hints": return `Hints · ${counts?.hints ?? 0}`;
      case "packaging": return "Packaging · physical production notes";
      case "done": return "Done · case shipped";
      default: return key;
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="inline-flex items-center gap-0 px-3 py-1.5 rounded-full bg-muted/40 border">
        {PHASES.map((p, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx;
          const tab = TAB_FOR_PHASE[p.key] ?? "overview";
          return (
            <div key={p.key} className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onJump(tab)}
                    className="group relative flex items-center gap-1.5 px-1.5 py-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label={p.label}
                  >
                    <span
                      className={cn(
                        "rounded-full transition-all",
                        isCurrent
                          ? "h-2.5 w-2.5 bg-accent ring-4 ring-accent/20"
                          : isPast
                            ? "h-1.5 w-1.5 bg-emerald-500"
                            : "h-1.5 w-1.5 bg-muted-foreground/30 group-hover:bg-muted-foreground/60"
                      )}
                    />
                    {isCurrent && (
                      <span className="text-[11px] font-semibold text-foreground tracking-wide">
                        {p.label}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {tooltipFor(p.key)}
                </TooltipContent>
              </Tooltip>
              {i < PHASES.length - 1 && (
                <span
                  className={cn(
                    "h-px w-4 md:w-6 transition-colors",
                    i < currentIdx ? "bg-emerald-500/50" : "bg-muted-foreground/20"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export { normalizePhase };

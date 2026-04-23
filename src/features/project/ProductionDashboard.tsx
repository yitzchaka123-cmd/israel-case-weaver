import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { FileText, Users, Network, Mail, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizePhase } from "./PhaseStatusBar";
import { useAssistantRunStatus } from "./assistant/useAssistantRun";

function nextActionFor(phase: string, docs: number, target: number | null, logicApproved: boolean): string {
  switch (phase) {
    case "setup":
      return "Open Assistant to confirm title, mystery type and case brief.";
    case "summary":
      return "Lock in the solution summary in the Assistant to advance.";
    case "structure":
      return logicApproved
        ? "Logic flow approved — ready to start generating documents."
        : "Jump to Case Board to review and approve the logic flow.";
    case "documents": {
      if (target && docs < target) return `${target - docs} documents to go — open Assistant to keep generating.`;
      return "Documents complete — move on to envelopes.";
    }
    case "envelopes":
      return "Open Envelopes and let the Assistant assign documents to envelopes.";
    case "hints":
      return "Generate stage-by-stage hints in the Hints tab.";
    case "packaging":
      return "Add packaging notes — print sizes, materials, assembly.";
    case "done":
      return "Case shipped. 🎉";
    default:
      return "";
  }
}

export function ProductionDashboard({
  projectId,
  phase,
  targetDocCount,
  logicApprovedAt,
  onJump,
}: {
  projectId: string;
  phase: string | null | undefined;
  targetDocCount: number | null;
  logicApprovedAt: string | null;
  onJump: (tab: string) => void;
}) {
  const normalized = normalizePhase(phase);
  const logicApproved = !!logicApprovedAt;

  const { data } = useQuery({
    queryKey: ["production-dashboard", projectId],
    queryFn: async () => {
      const [docsRes, suspectsRes, nodesRes, envsRes, hintsRes] = await Promise.all([
        supabase.from("documents").select("id, status").eq("project_id", projectId),
        supabase.from("suspects").select("id, is_red_herring").eq("project_id", projectId),
        supabase.from("canvas_nodes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("envelopes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("hints").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      ]);
      const docs = docsRes.data ?? [];
      const suspects = suspectsRes.data ?? [];
      return {
        docTotal: docs.length,
        docFinal: docs.filter((d: any) => d.status === "final").length,
        docDraft: docs.filter((d: any) => d.status === "draft").length,
        suspects: suspects.length,
        redHerrings: suspects.filter((s: any) => s.is_red_herring).length,
        nodes: nodesRes.count ?? 0,
        envelopes: envsRes.count ?? 0,
        hints: hintsRes.count ?? 0,
      };
    },
  });

  const docs = data?.docTotal ?? 0;
  const docTarget = targetDocCount ?? 0;
  const docPct = docTarget > 0 ? Math.min(100, Math.round((docs / docTarget) * 100)) : 0;

  const assistantRunning = useAssistantRunStatus(projectId);

  return (
    <div className="space-y-4">
      {assistantRunning && (
        <button
          type="button"
          onClick={() => onJump("assistant")}
          className="w-full flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-foreground hover:bg-accent/20 transition-colors"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          <span className="font-medium">Assistant is working on your case…</span>
          <span className="text-muted-foreground ml-1">Tap to view progress</span>
          <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground" />
        </button>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          icon={<FileText className="h-3.5 w-3.5" />}
          label="Documents"
          value={docTarget > 0 ? `${docs} / ${docTarget}` : `${docs}`}
          caption={data ? `${data.docFinal} final · ${data.docDraft} draft` : "—"}
          onClick={() => onJump("documents")}
        >
          {docTarget > 0 && <Progress value={docPct} className="h-1 mt-2" />}
        </Tile>
        <Tile
          icon={<Users className="h-3.5 w-3.5" />}
          label="Suspects"
          value={`${data?.suspects ?? 0}`}
          caption={data?.redHerrings ? `${data.redHerrings} red herring${data.redHerrings === 1 ? "" : "s"}` : "no red herrings"}
          onClick={() => onJump("suspects")}
        />
        <Tile
          icon={<Network className="h-3.5 w-3.5" />}
          label="Canvas nodes"
          value={`${data?.nodes ?? 0}`}
          caption={
            <span className={logicApproved ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
              {logicApproved ? "Logic flow approved" : "Logic flow pending"}
            </span>
          }
          onClick={() => onJump("canvas")}
        />
        <Tile
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Envelopes / Hints"
          value={`${data?.envelopes ?? 0} · ${data?.hints ?? 0}`}
          caption={`${data?.envelopes ?? 0} envelope${data?.envelopes === 1 ? "" : "s"} · ${data?.hints ?? 0} hint${data?.hints === 1 ? "" : "s"}`}
          onClick={() => onJump("envelopes")}
        />
      </div>

      <button
        type="button"
        onClick={() => onJump("assistant")}
        title="Open the Assistant"
        className="w-full flex items-start gap-2 px-3 py-2.5 rounded-lg bg-accent/5 border border-accent/20 text-sm text-left hover:bg-accent/10 hover:border-accent/40 transition-colors cursor-pointer"
      >
        <ArrowRight className="h-4 w-4 mt-0.5 text-accent shrink-0" />
        <span className="text-foreground/80">
          <span className="font-medium text-foreground">Next:</span>{" "}
          {nextActionFor(normalized, docs, targetDocCount, logicApproved)}
        </span>
      </button>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  caption,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: React.ReactNode;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left p-3 rounded-xl border bg-card/50 hover:bg-card hover:border-accent/40 transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {icon}
        {label}
      </div>
      <div className="font-display text-2xl mt-1 leading-none">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1.5 truncate">{caption}</div>
      {children}
    </button>
  );
}

import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  FastForward,
  Loader2,
  PencilLine,
  ScrollText,
} from "lucide-react";

type ProposedDoc = {
  title?: string;
  doc_type?: string;
  purpose?: string;
  linked_logic_node_titles?: string[] | null;
};

export function ProposalStatusStrip({
  projectId,
  proposal,
  status,
  approvedAt,
  logicApprovedAt,
}: {
  projectId: string;
  proposal: unknown;
  status: string | null | undefined;
  approvedAt: string | null | undefined;
  logicApprovedAt: string | null | undefined;
}) {
  const docs = useMemo<ProposedDoc[]>(() => {
    if (!Array.isArray(proposal)) return [];
    return proposal as ProposedDoc[];
  }, [proposal]);

  const [busy, setBusy] = useState<"approve" | "bypass" | "revise" | null>(null);

  // Don't show until logic has been approved and there's something to gate on.
  if (!logicApprovedAt) return null;

  const effectiveStatus = (status ?? "none") as
    | "none"
    | "proposed"
    | "approved"
    | "bypassed";

  const jumpToAssistant = (starter?: string) => {
    window.dispatchEvent(
      new CustomEvent("mystudio:navigate", {
        detail: { tab: "assistant", starter: starter ?? null },
      }),
    );
  };

  const setStatus = async (
    next: "approved" | "bypassed",
    label: string,
  ) => {
    setBusy(next === "approved" ? "approve" : "bypass");
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          proposed_document_set_status: next,
          proposed_document_set_approved_at: new Date().toISOString(),
        })
        .eq("id", projectId);
      if (error) throw error;
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  // Empty / nothing-proposed state — nudge the user to chat.
  if (effectiveStatus === "none" || docs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 p-4 mt-4">
        <div className="flex items-start gap-3">
          <ClipboardList className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">No document plan yet</div>
            <p className="text-xs text-muted-foreground mt-1">
              The assistant will reason through the Logic Flow and propose a
              specific list of documents — type, purpose, and which logic node
              each one serves — before any document is generated.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() =>
              jumpToAssistant(
                "Based on the approved Logic Flow, propose the document set we should produce.",
              )
            }
          >
            Ask assistant to plan
          </Button>
        </div>
      </div>
    );
  }

  const statusBadge =
    effectiveStatus === "approved" ? (
      <Badge variant="secondary" className="border">Approved</Badge>
    ) : effectiveStatus === "bypassed" ? (
      <Badge variant="outline">Bypassed (just build it)</Badge>
    ) : (
      <Badge>Awaiting your approval</Badge>
    );

  return (
    <div className="rounded-xl border bg-card mt-4 overflow-hidden">
      <div className="flex items-start gap-3 p-4 border-b bg-muted/30">
        <ScrollText className="h-4 w-4 text-foreground mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-medium">Document plan</div>
            {statusBadge}
            <span className="text-[11px] text-muted-foreground">
              {docs.length} document{docs.length === 1 ? "" : "s"} reasoned by the
              assistant
            </span>
          </div>
          {approvedAt && effectiveStatus !== "proposed" ? (
            <p className="text-[11px] text-muted-foreground mt-1">
              Decided {new Date(approvedAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-1">
              Review the plan below. Approve to build the Final Flow with these
              exact documents, bypass it to let the assistant build directly, or
              revise it in chat.
            </p>
          )}
        </div>
      </div>

      <ul className="divide-y max-h-72 overflow-y-auto">
        {docs.map((d, i) => (
          <li key={i} className="p-3 flex items-start gap-3">
            <div className="text-[11px] text-muted-foreground tabular-nums w-6 text-right pt-0.5">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-sm font-medium truncate">
                  {d.title ?? "Untitled document"}
                </div>
                {d.doc_type ? (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                    {d.doc_type}
                  </Badge>
                ) : null}
              </div>
              {d.purpose ? (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {d.purpose}
                </p>
              ) : null}
              {d.linked_logic_node_titles && d.linked_logic_node_titles.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {d.linked_logic_node_titles.map((t, j) => (
                    <span
                      key={j}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      → {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {effectiveStatus === "proposed" ? (
        <div className="flex items-center gap-2 p-3 border-t bg-muted/20 flex-wrap">
          <Button
            size="sm"
            onClick={() => setStatus("approved", "Plan approved")}
            disabled={busy !== null}
            className="gap-1.5"
          >
            {busy === "approve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Approve plan
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatus("bypassed", "Skipping plan — assistant will build directly")}
            disabled={busy !== null}
            className="gap-1.5"
          >
            {busy === "bypass" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FastForward className="h-3.5 w-3.5" />
            )}
            Just build it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              jumpToAssistant(
                "Let's revise the proposed document plan before approving it.",
              )
            }
            disabled={busy !== null}
            className="gap-1.5 text-muted-foreground"
          >
            <PencilLine className="h-3.5 w-3.5" />
            Revise in chat
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 border-t bg-muted/20 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              jumpToAssistant(
                "Let's revise the document plan and re-propose it.",
              )
            }
            className="gap-1.5 text-muted-foreground"
          >
            <PencilLine className="h-3.5 w-3.5" />
            Revise plan in chat
          </Button>
        </div>
      )}
    </div>
  );
}

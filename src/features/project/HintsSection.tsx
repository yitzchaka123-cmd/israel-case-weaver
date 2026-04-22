import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lightbulb, Plus, Trash2 } from "lucide-react";

interface Hint {
  id: string;
  project_id: string;
  stage: number;
  level: number;
  text: string | null;
}

const LEVELS = [
  { n: 1, label: "Vague nudge", tone: "muted" },
  { n: 2, label: "More helpful", tone: "accent" },
  { n: 3, label: "Reveals the task", tone: "warning" },
];

export function HintsSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["hints", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hints")
        .select("*")
        .eq("project_id", projectId)
        .order("stage")
        .order("level");
      if (error) throw error;
      return data as Hint[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`hints-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hints", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["hints", projectId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  const stages = useMemo(() => {
    const map = new Map<number, Record<number, Hint | undefined>>();
    (data ?? []).forEach((h) => {
      if (!map.has(h.stage)) map.set(h.stage, {});
      map.get(h.stage)![h.level] = h;
    });
    const maxStage = Math.max(0, ...Array.from(map.keys()));
    // Always show stages 1..max; offer an "add stage" affordance
    return Array.from({ length: Math.max(1, maxStage) }, (_, i) => ({
      stage: i + 1,
      byLevel: map.get(i + 1) ?? {},
    }));
  }, [data]);

  const addStage = async () => {
    const nextStage = stages.length + 1;
    // Insert 3 empty hints so the UI has full rows immediately
    await supabase.from("hints").insert(
      LEVELS.map((l) => ({ project_id: projectId, stage: nextStage, level: l.n, text: "" })),
    );
  };

  const upsertHint = async (stage: number, level: number, text: string, existing?: Hint) => {
    if (existing) {
      await supabase.from("hints").update({ text }).eq("id", existing.id);
    } else {
      await supabase.from("hints").insert({ project_id: projectId, stage, level, text });
    }
  };

  const deleteStage = async (stage: number) => {
    if (!confirm(`Delete stage ${stage} hints?`)) return;
    await supabase.from("hints").delete().eq("project_id", projectId).eq("stage", stage);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl">Hint system</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Three hints per stage — vague, helpful, then reveal. Linked to the printed hint card QR flow.
          </p>
        </div>
        <Button onClick={addStage} className="gap-2">
          <Plus className="h-4 w-4" /> Add stage
        </Button>
      </div>

      {stages.length === 0 || !data?.length ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center">
          <Lightbulb className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No hint stages yet. Add your first stage to begin.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stages.map(({ stage, byLevel }) => (
            <div key={stage} className="rounded-2xl border bg-card shadow-soft overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b bg-surface/40">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-accent/10 text-accent-foreground flex items-center justify-center text-sm font-semibold">
                    {stage}
                  </div>
                  <div className="font-display text-lg">Stage {stage}</div>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive gap-1.5" onClick={() => deleteStage(stage)}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
              <div className="grid md:grid-cols-3 gap-4 p-5">
                {LEVELS.map((l) => {
                  const existing = byLevel[l.n];
                  return (
                    <div key={l.n} className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                        {l.n}. {l.label}
                      </Label>
                      <Textarea
                        rows={4}
                        dir="rtl"
                        className="text-right"
                        defaultValue={existing?.text ?? ""}
                        onBlur={(e) => upsertHint(stage, l.n, e.target.value, existing)}
                        placeholder="כתוב את הרמז בעברית…"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

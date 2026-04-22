import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail } from "lucide-react";

interface Envelope {
  id: string;
  project_id: string;
  number: number;
  label: string | null;
  task: string | null;
  notes: string | null;
  status: string;
}

const SLOTS: Array<{ n: number; title: string; hint: string }> = [
  { n: 0, title: "Open First", hint: "Mission briefing + first task" },
  { n: 1, title: "Envelope 1", hint: "Confirm task 1, hand off to task 2" },
  { n: 2, title: "Envelope 2", hint: "Confirm task 2, hand off to task 3" },
  { n: 3, title: "Envelope 3", hint: "Confirm task 3, hand off to final" },
  { n: 4, title: "Envelope 4", hint: "Confirm final assessment + QR to news report" },
];

const STATUSES = ["draft", "in_progress", "review", "final"];

const FOOTNOTE_HE = "פתחו את המעטפה הבאה רק אם אתם בטוחים שביצעתם את המשימה הקודמת כראוי.";

export function EnvelopesSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<number, Partial<Envelope>>>({});

  const { data } = useQuery({
    queryKey: ["envelopes", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("envelopes")
        .select("*")
        .eq("project_id", projectId)
        .order("number");
      if (error) throw error;
      return data as Envelope[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`envelopes-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "envelopes", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["envelopes", projectId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  const getEnvelope = (n: number): Envelope | undefined =>
    data?.find((e) => e.number === n);

  const upsert = async (n: number, patch: Partial<Envelope>) => {
    setDraft((d) => ({ ...d, [n]: { ...d[n], ...patch } }));
    const existing = getEnvelope(n);
    if (existing) {
      await supabase.from("envelopes").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("envelopes").insert({
        project_id: projectId,
        number: n,
        status: "draft",
        ...patch,
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div>
        <h2 className="font-display text-3xl">Envelopes</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Five sealed envelopes drive the flow. Keep tasks short, bold, and never spoiler-heavy.
        </p>
      </div>

      <div className="grid gap-4">
        {SLOTS.map((slot) => {
          const env = getEnvelope(slot.n);
          const local = draft[slot.n] ?? {};
          const value = <K extends keyof Envelope>(k: K) =>
            (local[k] as Envelope[K] | undefined) ?? env?.[k] ?? ("" as unknown as Envelope[K]);

          return (
            <div key={slot.n} className="rounded-2xl border bg-card shadow-soft overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b bg-surface/40">
                <div className="h-10 w-10 rounded-xl bg-gradient-brand text-white flex items-center justify-center shadow-glow">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg leading-tight">{slot.title}</div>
                  <div className="text-xs text-muted-foreground">{slot.hint}</div>
                </div>
                <Select
                  value={(value("status") as string) || "draft"}
                  onValueChange={(v) => upsert(slot.n, { status: v })}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid md:grid-cols-2 gap-4 p-5">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Label (Hebrew)</Label>
                  <Input
                    dir="rtl"
                    className="text-right"
                    value={value("label") as string}
                    onChange={(e) => upsert(slot.n, { label: e.target.value })}
                    placeholder="למשל: מעטפה ראשונה"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Task (Hebrew, short & bold)</Label>
                  <Input
                    dir="rtl"
                    className="text-right font-semibold text-red-600"
                    value={value("task") as string}
                    onChange={(e) => upsert(slot.n, { task: e.target.value })}
                    placeholder="המשימה — קצרה, ברורה, לא חושפת"
                  />
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Internal notes</Label>
                  <Textarea
                    rows={2}
                    value={value("notes") as string}
                    onChange={(e) => upsert(slot.n, { notes: e.target.value })}
                    placeholder="What is revealed, what is withheld, which documents belong here…"
                  />
                </div>
                <div className="md:col-span-2 rounded-lg bg-muted/50 border border-dashed px-3 py-2 text-[11px] text-muted-foreground" dir="rtl">
                  {FOOTNOTE_HE}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

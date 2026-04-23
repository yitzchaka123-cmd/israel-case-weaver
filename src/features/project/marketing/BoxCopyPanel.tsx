// Panel B — Box copy: front_subtext, back_headline, back_body, tagline.
// Each field has Generate / Regenerate via the new generate-marketing-copy edge fn.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

type CopyField = "front_subtext" | "back_headline" | "back_body" | "tagline";

interface Marketing {
  project_id: string;
  front_subtext: string | null;
  back_headline: string | null;
  back_body: string | null;
  tagline: string | null;
  copy_origins: Record<string, string>;
}

const FIELD_META: Array<{ key: CopyField; label: string; helper: string; rows: number; multiline: boolean }> = [
  { key: "tagline", label: "Tagline", helper: "One-liner for ads & social — under 9 words.", rows: 2, multiline: false },
  { key: "front_subtext", label: "Front subtext", helper: "1–2 lines under the title on the front of the box.", rows: 2, multiline: true },
  { key: "back_headline", label: "Back headline", helper: "Punchy stake-setting line for the back of the box.", rows: 2, multiline: false },
  { key: "back_body", label: "Back body", helper: "60–90 words. Mentions player role, doc/envelope counts, age. No spoilers.", rows: 6, multiline: true },
];

async function callEdge(name: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

export function BoxCopyPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<CopyField, string>>({
    front_subtext: "", back_headline: "", back_body: "", tagline: "",
  });
  const [origins, setOrigins] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["project-marketing", projectId],
    queryFn: async (): Promise<Marketing | null> => {
      const { data, error } = await supabase.from("project_marketing").select("*").eq("project_id", projectId).maybeSingle();
      if (error) throw error;
      return (data as Marketing) ?? null;
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        front_subtext: data.front_subtext ?? "",
        back_headline: data.back_headline ?? "",
        back_body: data.back_body ?? "",
        tagline: data.tagline ?? "",
      });
      setOrigins((data.copy_origins ?? {}) as Record<string, string>);
    }
  }, [data]);

  const update = (k: CopyField, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const generateField = async (field: CopyField | "all") => {
    setBusy((b) => ({ ...b, [field]: true }));
    try {
      const resp = await callEdge("generate-marketing-copy", { projectId, field });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Failed to generate copy", { duration: 10000 });
        return;
      }
      const copy = (json.copy ?? {}) as Partial<Record<CopyField, string>>;
      setForm((f) => ({ ...f, ...copy }));
      const newOrigins = { ...origins };
      for (const k of Object.keys(copy)) newOrigins[k] = "ai";
      setOrigins(newOrigins);
      toast.success(field === "all" ? "Box copy drafted" : `${FIELD_META.find((m) => m.key === field)?.label ?? field} drafted`);
    } finally {
      setBusy((b) => ({ ...b, [field]: false }));
    }
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("project_marketing")
      .upsert({
        project_id: projectId,
        ...form,
        copy_origins: origins,
      } as never, { onConflict: "project_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["project-marketing", projectId] });
      toast.success("Box copy saved");
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-xl">Box copy</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tagline, front subtext, and back-of-box headline + body. Editable; AI-drafted on demand.
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          className="gap-1.5"
          onClick={() => generateField("all")}
          disabled={!!busy.all}
        >
          {busy.all ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Draft all with assistant
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {FIELD_META.map((m) => (
          <div key={m.key} className={m.key === "back_body" ? "md:col-span-2" : ""}>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {m.label} {origins[m.key] === "ai" && <span className="ml-1.5 text-accent normal-case tracking-normal">· AI draft</span>}
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-[11px]"
                onClick={() => generateField(m.key)}
                disabled={!!busy[m.key]}
              >
                {busy[m.key] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {form[m.key]?.trim() ? "Regenerate" : "Generate"}
              </Button>
            </div>
            {m.multiline ? (
              <Textarea
                rows={m.rows}
                value={form[m.key]}
                onChange={(e) => update(m.key, e.target.value)}
                placeholder={m.helper}
                className="text-sm"
              />
            ) : (
              <Input
                value={form[m.key]}
                onChange={(e) => update(m.key, e.target.value)}
                placeholder={m.helper}
                className="text-sm"
              />
            )}
            <p className="text-[10px] text-muted-foreground mt-1">{m.helper}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save copy
        </Button>
      </div>
    </section>
  );
}

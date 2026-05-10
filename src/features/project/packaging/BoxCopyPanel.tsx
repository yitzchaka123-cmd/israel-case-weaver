// Professional box text planner for front/back packaging copy and mini movie QR.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createQrPngBlob } from "./qr";
import { ImageIcon, Loader2, QrCode, Save, Sparkles } from "lucide-react";
import { useActiveCompanyProfile } from "@/lib/useActiveCompanyProfile";
import { toast } from "sonner";

type CopyField =
  | "front_subtext"
  | "back_headline"
  | "back_teaser"
  | "back_body"
  | "back_whats_in_box"
  | "back_how_to_play"
  | "back_feature_bullets"
  | "back_specs"
  | "back_content_note"
  | "back_footer_text"
  | "mini_movie_url"
  | "qr_label"
  | "qr_helper_text"
  | "qr_code_url";

type GenerateTarget = CopyField | "front" | "back" | "all";

interface Marketing {
  project_id: string;
  copy_origins: Record<string, string> | null;
  [key: string]: string | Record<string, string> | null;
}


const FRONT_FIELDS: Array<{ key: CopyField; label: string; helper: string; rows: number; multiline: boolean }> = [
  { key: "front_subtext", label: "Bottom paragraph", helper: "Single paragraph baked across the bottom of the front cover. Title, subtitle, and brand logo are wired automatically — this is the only front-cover copy field.", rows: 4, multiline: true },
];

const BACK_FIELDS: Array<{ key: CopyField; label: string; helper: string; rows: number; multiline: boolean }> = [
  { key: "back_headline", label: "Back headline", helper: "Big hook at the top of the back box.", rows: 1, multiline: false },
  { key: "back_teaser", label: "Short teaser", helper: "1–2 sentence cinematic setup.", rows: 3, multiline: true },
  { key: "back_body", label: "Main back description", helper: "Longer sales copy explaining the game without spoilers.", rows: 6, multiline: true },
  { key: "back_whats_in_box", label: "What’s in the box", helper: "Line-based list of documents, envelopes, evidence, props, QR preview, etc.", rows: 5, multiline: true },
  { key: "back_how_to_play", label: "How to play", helper: "Short explanation of the player experience.", rows: 4, multiline: true },
  { key: "back_feature_bullets", label: "Feature bullets", helper: "3–5 selling points, one per line.", rows: 5, multiline: true },
  { key: "back_specs", label: "Age / duration / players", helper: "Packaging metadata such as Ages 14+, 60–120 minutes, 1–6 players.", rows: 2, multiline: true },
  { key: "back_content_note", label: "Spoiler-safe warning / content note", helper: "Optional caution, tone note, or content warning.", rows: 2, multiline: true },
  { key: "back_footer_text", label: "Company/legal/footer text", helper: "Footer, legal, support, and brand text for the back cover.", rows: 4, multiline: true },
];

const QR_FIELDS: Array<{ key: CopyField; label: string; helper: string }> = [
  { key: "mini_movie_url", label: "Mini movie preview URL", helper: "Paste the preview link to generate a QR code." },
  { key: "qr_label", label: "QR label", helper: "Watch the mini movie preview" },
  { key: "qr_helper_text", label: "QR helper text", helper: "Scan to watch the cinematic case teaser." },
];

const EMPTY_FORM: Record<CopyField, string> = {
  front_subtext: "",
  back_headline: "",
  back_teaser: "",
  back_body: "",
  back_whats_in_box: "",
  back_how_to_play: "",
  back_feature_bullets: "",
  back_specs: "",
  back_content_note: "",
  back_footer_text: "",
  mini_movie_url: "",
  qr_label: "",
  qr_helper_text: "",
  qr_code_url: "",
};

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
  const [form, setForm] = useState<Record<CopyField, string>>(EMPTY_FORM);
  const [origins, setOrigins] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["project-marketing", projectId],
    queryFn: async (): Promise<Marketing | null> => {
      const { data, error } = await supabase.from("project_marketing").select("*").eq("project_id", projectId).maybeSingle();
      if (error) throw error;
      return (data as Marketing) ?? null;
    },
  });

  const { data: company } = useActiveCompanyProfile(projectId);

  useEffect(() => {
    if (!data) return;
    setForm((current) => {
      const next = { ...current };
      for (const key of Object.keys(EMPTY_FORM) as CopyField[]) {
        next[key] = typeof data[key] === "string" ? data[key] as string : "";
      }
      return next;
    });
    setOrigins((data.copy_origins ?? {}) as Record<string, string>);
  }, [data]);

  const update = (k: CopyField, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const generateField = async (field: GenerateTarget) => {
    setBusy((b) => ({ ...b, [field]: true }));
    try {
      const resp = await callEdge("generate-marketing-copy", { projectId, field });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Failed to generate box text", { duration: 10000 });
        return;
      }
      const copy = (json.copy ?? {}) as Partial<Record<CopyField, string>>;
      setForm((f) => ({ ...f, ...copy }));
      const newOrigins = { ...origins };
      for (const k of Object.keys(copy)) newOrigins[k] = "ai";
      setOrigins(newOrigins);
      toast.success(field === "all" ? "Box text drafted" : field === "front" ? "Front cover text drafted" : field === "back" ? "Back cover text drafted" : "Box text field drafted");
    } finally {
      setBusy((b) => ({ ...b, [field]: false }));
    }
  };

  const save = async (override?: Partial<Record<CopyField, string>>) => {
    setSaving(true);
    const payload = { ...form, ...override };
    const { error } = await supabase
      .from("project_marketing")
      .upsert({ project_id: projectId, ...payload, copy_origins: origins } as never, { onConflict: "project_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["project-marketing", projectId] });
      toast.success("Box text saved");
    }
  };

  const generateQr = async () => {
    const url = form.mini_movie_url.trim();
    if (!url) {
      toast.error("Add a mini movie preview URL first");
      return;
    }
    setQrBusy(true);
    try {
      const blob = await createQrPngBlob(url);
      const path = `${projectId}/marketing/qr/mini-movie-preview.png`;
      const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: "image/png", upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?v=${Date.now()}`;
      setForm((f) => ({ ...f, qr_code_url: publicUrl }));
      await save({ qr_code_url: publicUrl });
      toast.success("Mini movie QR saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "QR generation failed");
    } finally {
      setQrBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-xl">Box Text</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Professional front and back game-box copy, logo guidance, packaging details, and mini movie QR text.
          </p>
        </div>
        <Button variant="default" size="sm" className="gap-1.5" onClick={() => generateField("all")} disabled={!!busy.all}>
          {busy.all ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Draft all box text
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <TextSection title="Front cover text" onDraft={() => generateField("front")} busy={!!busy.front}>
          {company?.logo_url && (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
              <img src={company.logo_url} alt="Company logo" className="h-12 w-12 rounded-lg border bg-background object-contain" />
              <div className="min-w-0">
                <div className="text-xs font-medium flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Company logo available</div>
                <p className="text-[11px] text-muted-foreground truncate">{company.company_name ?? "Company profile"}</p>
              </div>
            </div>
          )}
          {FRONT_FIELDS.map((field) => (
            <FieldEditor key={field.key} meta={field} value={form[field.key]} origin={origins[field.key]} busy={!!busy[field.key]} onChange={(v) => update(field.key, v)} onGenerate={() => generateField(field.key)} />
          ))}
        </TextSection>

        <TextSection title="Back cover text + QR" onDraft={() => generateField("back")} busy={!!busy.back}>
          {BACK_FIELDS.map((field) => (
            <FieldEditor key={field.key} meta={field} value={form[field.key]} origin={origins[field.key]} busy={!!busy[field.key]} onChange={(v) => update(field.key, v)} onGenerate={() => generateField(field.key)} />
          ))}

          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">Mini movie preview QR</h4>
                <p className="text-[11px] text-muted-foreground">Saved for back-cover artwork and project export.</p>
              </div>
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={generateQr} disabled={qrBusy}>
                {qrBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
                Generate QR
              </Button>
            </div>
            {QR_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{field.label}</Label>
                <Input value={form[field.key]} onChange={(e) => update(field.key, e.target.value)} placeholder={field.helper} className="text-sm" />
              </div>
            ))}
            {form.qr_code_url ? (
              <img src={form.qr_code_url} alt="Mini movie preview QR code" className="h-28 w-28 rounded-lg border bg-background object-contain p-2" />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed bg-background text-muted-foreground">
                <QrCode className="h-7 w-7" />
              </div>
            )}
          </div>
        </TextSection>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save()} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save box text
        </Button>
      </div>
    </section>
  );
}

function TextSection({ title, busy, onDraft, children }: { title: string; busy: boolean; onDraft: () => void; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-background/60 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-display text-lg">{title}</h4>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onDraft} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Draft section
        </Button>
      </div>
      {children}
    </div>
  );
}

function FieldEditor({ meta, value, origin, busy, onChange, onGenerate }: { meta: { key: CopyField; label: string; helper: string; rows: number; multiline: boolean }; value: string; origin?: string; busy: boolean; onChange: (value: string) => void; onGenerate: () => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {meta.label} {origin === "ai" && <span className="ml-1.5 text-accent normal-case tracking-normal">· AI draft</span>}
        </Label>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={onGenerate} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {value?.trim() ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {meta.multiline ? (
        <Textarea rows={meta.rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={meta.helper} className="text-sm" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={meta.helper} className="text-sm" />
      )}
      <p className="text-[10px] text-muted-foreground">{meta.helper}</p>
    </div>
  );
}

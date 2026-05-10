// Box Text panel — final field set.
// Front: Title (read-only), Tagline, Bottom paragraph, Design notes.
// Back: Headline, Teaser→QR, In-game scenes (4), Body, Contents, Specs, Footer,
// EAN-13 barcode preview/generate, Brand footer preview + brand selector.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Barcode as BarcodeIcon, Building2, Image as ImageIcon, Loader2, QrCode,
  RefreshCw, Save, Sparkles,
} from "lucide-react";
import { useActiveCompanyProfile, useUserCompanyProfiles } from "@/lib/useActiveCompanyProfile";
import { ean13ToPngBlob, ean13ToSvg, generateEan13 } from "./ean13";
import { InGameScenesPanel } from "./InGameScenesPanel";
import { DownloadButton } from "@/components/DownloadButton";
import { toast } from "sonner";

type ProjectField = "tagline" | "front_subtext" | "back_headline" | "back_teaser" | "back_body" | "back_whats_in_box" | "back_specs" | "back_footer_text";

interface Marketing {
  project_id: string;
  copy_origins: Record<string, string> | null;
  tagline: string | null;
  front_subtext: string | null;
  back_headline: string | null;
  back_teaser: string | null;
  back_body: string | null;
  back_whats_in_box: string | null;
  back_specs: string | null;
  back_footer_text: string | null;
  barcode_value: string | null;
  barcode_url: string | null;
}

const EMPTY: Record<ProjectField, string> = {
  tagline: "",
  front_subtext: "",
  back_headline: "",
  back_teaser: "",
  back_body: "",
  back_whats_in_box: "",
  back_specs: "",
  back_footer_text: "",
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
  const [form, setForm] = useState<Record<ProjectField, string>>(EMPTY);
  const [origins, setOrigins] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [designNotes, setDesignNotes] = useState("");
  const [genBarcode, setGenBarcode] = useState(false);

  const { data: project } = useQuery({
    queryKey: ["project-box-copy-meta", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("title, subtitle, cover_prompt, company_profile_id")
        .eq("id", projectId)
        .maybeSingle();
      return data;
    },
  });
  useEffect(() => { setDesignNotes(project?.cover_prompt ?? ""); }, [project?.cover_prompt]);

  const { data } = useQuery({
    queryKey: ["project-marketing", projectId],
    queryFn: async (): Promise<Marketing | null> => {
      const { data, error } = await supabase.from("project_marketing").select("*").eq("project_id", projectId).maybeSingle();
      if (error) throw error;
      return (data as Marketing) ?? null;
    },
  });

  const { data: company } = useActiveCompanyProfile(projectId);
  const { data: allBrands } = useUserCompanyProfiles();

  const { data: primaryQr } = useQuery({
    queryKey: ["project-qr-primary", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("project_qr_codes")
        .select("id, label, target_url, qr_image_url")
        .eq("project_id", projectId)
        .eq("is_primary", true)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setForm((cur) => {
      const next = { ...cur };
      for (const k of Object.keys(EMPTY) as ProjectField[]) {
        const v = data[k as keyof Marketing];
        next[k] = typeof v === "string" ? v : "";
      }
      return next;
    });
    setOrigins((data.copy_origins ?? {}) as Record<string, string>);
  }, [data]);

  const update = (k: ProjectField, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const generateField = async (field: ProjectField | "front" | "back" | "all") => {
    setBusy((b) => ({ ...b, [field]: true }));
    try {
      const resp = await callEdge("generate-marketing-copy", { projectId, field });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Failed to generate", { duration: 10000 });
        return;
      }
      const copy = (json.copy ?? {}) as Partial<Record<ProjectField, string>>;
      setForm((f) => ({ ...f, ...copy }));
      const newOrigins = { ...origins };
      for (const k of Object.keys(copy)) newOrigins[k] = "ai";
      setOrigins(newOrigins);
      toast.success("Drafted");
    } finally {
      setBusy((b) => ({ ...b, [field]: false }));
    }
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("project_marketing")
      .upsert({ project_id: projectId, ...form, copy_origins: origins } as never, { onConflict: "project_id" });
    if (!error) {
      await supabase.from("projects").update({ cover_prompt: designNotes }).eq("id", projectId);
    }
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["project-marketing", projectId] });
      qc.invalidateQueries({ queryKey: ["project-marketing-pair", projectId] });
      qc.invalidateQueries({ queryKey: ["project-cover-only", projectId] });
      toast.success("Box text saved");
    }
  };

  const handleGenerateBarcode = async () => {
    setGenBarcode(true);
    try {
      const code = generateEan13();
      const blob = await ean13ToPngBlob(code);
      const path = `${projectId}/marketing/barcode-${code}.png`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, blob, { upsert: true, contentType: "image/png" });
      if (upErr) { toast.error(upErr.message); return; }
      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      const { error } = await supabase.from("project_marketing")
        .upsert({ project_id: projectId, barcode_value: code, barcode_url: pub.publicUrl } as never, { onConflict: "project_id" });
      if (error) { toast.error(error.message); return; }
      qc.invalidateQueries({ queryKey: ["project-marketing", projectId] });
      qc.invalidateQueries({ queryKey: ["project-marketing-barcode", projectId] });
      toast.success(`Barcode ${code} generated`);
    } finally {
      setGenBarcode(false);
    }
  };

  const setBrand = async (id: string) => {
    const { error } = await supabase.from("projects").update({ company_profile_id: id } as never).eq("id", projectId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["project-box-copy-meta", projectId] });
    qc.invalidateQueries({ queryKey: ["active-company-profile", projectId] });
    toast.success("Brand updated");
  };

  const houseRef = (company?.reference_covers ?? []).find((r) => r.is_default) ?? (company?.reference_covers ?? [])[0] ?? null;

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-xl">Box Text</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Front + back copy. Title and brand come from elsewhere; only the bake-able fields live here.
          </p>
        </div>
        <Button variant="default" size="sm" className="gap-1.5" onClick={() => generateField("all")} disabled={!!busy.all}>
          {busy.all ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Draft all box text
        </Button>
      </div>

      {/* ============================ FRONT ============================ */}
      <Section title="Front cover text" onDraft={() => generateField("front")} busy={!!busy.front}>
        {/* Brand reference chip */}
        {houseRef?.url && (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
            <img src={houseRef.url} alt="Brand reference" className="h-14 w-12 rounded border bg-background object-cover" />
            <div className="min-w-0 text-[11px] text-muted-foreground leading-relaxed">
              <div className="text-foreground font-medium text-xs flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" /> Brand reference in use
              </div>
              <div className="truncate">{company?.company_name ?? "House style"} — sent to the cover generator alongside your design notes.</div>
            </div>
          </div>
        )}

        <ReadOnlyRow label="Title" value={project?.title ?? ""} hint="Pulled from project Overview." />

        <FieldEditor
          label="Tagline (under title)"
          helper="Short line baked directly under the title on the front cover."
          rows={1}
          multiline={false}
          value={form.tagline}
          origin={origins.tagline}
          busy={!!busy.tagline}
          onChange={(v) => update("tagline", v)}
          onGenerate={() => generateField("tagline")}
        />

        <FieldEditor
          label="Bottom paragraph"
          helper="Single paragraph baked across the bottom strip of the front cover."
          rows={4}
          multiline
          value={form.front_subtext}
          origin={origins.front_subtext}
          busy={!!busy.front_subtext}
          onChange={(v) => update("front_subtext", v)}
          onGenerate={() => generateField("front_subtext")}
        />

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Design notes</Label>
          <Textarea
            rows={3}
            value={designNotes}
            onChange={(e) => setDesignNotes(e.target.value)}
            placeholder="Art direction, mood, colors. These notes are sent to the cover generator together with the brand reference image above."
            className="text-sm"
          />
          <p className="text-[10px] text-muted-foreground">Sent to the cover generator alongside the brand reference image.</p>
        </div>
      </Section>

      {/* ============================ BACK ============================ */}
      <Section title="Back cover text" onDraft={() => generateField("back")} busy={!!busy.back}>
        <FieldEditor
          label="Back headline"
          helper="Big hook at the top of the back box."
          rows={1}
          multiline={false}
          value={form.back_headline}
          origin={origins.back_headline}
          busy={!!busy.back_headline}
          onChange={(v) => update("back_headline", v)}
          onGenerate={() => generateField("back_headline")}
        />

        {/* Teaser + primary QR side-by-side */}
        <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
          <FieldEditor
            label="Short teaser → QR"
            helper="Ends with an arrow pointing to the QR. The YouTube teaser must match this copy."
            rows={3}
            multiline
            value={form.back_teaser}
            origin={origins.back_teaser}
            busy={!!busy.back_teaser}
            onChange={(v) => update("back_teaser", v)}
            onGenerate={() => generateField("back_teaser")}
          />
          <div className="flex flex-col items-center gap-1 pt-6">
            {primaryQr?.qr_image_url ? (
              <img src={primaryQr.qr_image_url} alt="Primary QR" className="h-20 w-20 rounded border bg-white p-1 object-contain" />
            ) : (
              <div className="h-20 w-20 rounded border border-dashed bg-muted flex items-center justify-center">
                <QrCode className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <span className="text-[10px] text-muted-foreground">{primaryQr?.label ?? "Primary QR"}</span>
            <a href="#packaging-barcode" className="text-[10px] text-accent hover:underline">Manage</a>
          </div>
        </div>

        {/* In-game scenes (moved here) */}
        <InGameScenesPanel
          projectId={projectId}
          brandReferenceUrl={houseRef?.url ?? null}
          brandLabel={company?.company_name ?? null}
        />

        <FieldEditor
          label="Main back description"
          helper="Longer sales copy explaining the game without spoilers."
          rows={6}
          multiline
          value={form.back_body}
          origin={origins.back_body}
          busy={!!busy.back_body}
          onChange={(v) => update("back_body", v)}
          onGenerate={() => generateField("back_body")}
        />

        <FieldEditor
          label="Contents"
          helper="What's in the box — documents, envelopes, props, evidence."
          rows={5}
          multiline
          value={form.back_whats_in_box}
          origin={origins.back_whats_in_box}
          busy={!!busy.back_whats_in_box}
          onChange={(v) => update("back_whats_in_box", v)}
          onGenerate={() => generateField("back_whats_in_box")}
        />

        <FieldEditor
          label="Age / duration / players"
          helper="Ages 14+, 60–120 min, 1–6 players. Also baked on the front cover."
          rows={2}
          multiline
          value={form.back_specs}
          origin={origins.back_specs}
          busy={!!busy.back_specs}
          onChange={(v) => update("back_specs", v)}
          onGenerate={() => generateField("back_specs")}
        />

        <FieldEditor
          label="Company / legal / footer text"
          helper="Footer line, support, legal."
          rows={3}
          multiline
          value={form.back_footer_text}
          origin={origins.back_footer_text}
          busy={!!busy.back_footer_text}
          onChange={(v) => update("back_footer_text", v)}
          onGenerate={() => generateField("back_footer_text")}
        />

        {/* EAN-13 inline */}
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarcodeIcon className="h-4 w-4" /> EAN-13 barcode
          </div>
          <div className="aspect-[5/2] bg-white rounded-lg flex items-center justify-center overflow-hidden border">
            {data?.barcode_value ? (
              <div className="w-full h-full flex items-center justify-center" dangerouslySetInnerHTML={{ __html: ean13ToSvg(data.barcode_value) }} />
            ) : (
              <span className="text-xs text-muted-foreground">No barcode yet</span>
            )}
          </div>
          {data?.barcode_value && (
            <div className="text-xs font-mono text-center text-muted-foreground">{data.barcode_value}</div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleGenerateBarcode} disabled={genBarcode} variant={data?.barcode_url ? "outline" : "default"} size="sm" className="flex-1 gap-1.5">
              {genBarcode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : data?.barcode_url ? <RefreshCw className="h-3.5 w-3.5" /> : <BarcodeIcon className="h-3.5 w-3.5" />}
              {data?.barcode_url ? "Regenerate" : "Generate barcode"}
            </Button>
            {data?.barcode_url && <DownloadButton url={data.barcode_url} title={`barcode-${data.barcode_value ?? ""}`} variant="outline" />}
          </div>
        </div>

        {/* Brand footer preview + selector */}
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="h-4 w-4" /> Brand footer (baked on the back)
            </div>
            <Select value={project?.company_profile_id ?? undefined} onValueChange={setBrand}>
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder="Select brand" />
              </SelectTrigger>
              <SelectContent>
                {(allBrands ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">
                    {b.name}{b.is_default ? " · default" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-14 w-14 rounded border bg-background flex items-center justify-center overflow-hidden shrink-0">
              {company?.logo_url ? (
                <img src={company.logo_url} alt="Brand logo" className="w-full h-full object-contain" />
              ) : (
                <Building2 className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1 text-[11px] text-muted-foreground leading-relaxed">
              <div className="text-foreground font-medium text-xs">{company?.company_name ?? "No brand selected"}</div>
              {company?.address && <div className="truncate">{company.address}</div>}
              {company?.box_footer_line && <div className="truncate">{company.box_footer_line}</div>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {company?.age_rating && <span>Ages {company.age_rating}</span>}
                {company?.made_in && <span>Made in {company.made_in}</span>}
                {company?.warning_text && <span className="truncate">{company.warning_text}</span>}
                {company?.legal_text && <span className="truncate">{company.legal_text}</span>}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save box text
        </Button>
      </div>
    </section>
  );
}

function Section({ title, busy, onDraft, children }: { title: string; busy: boolean; onDraft: () => void; children: ReactNode }) {
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

function ReadOnlyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Input value={value} disabled className="text-sm bg-muted/30" />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FieldEditor({ label, helper, rows, multiline, value, origin, busy, onChange, onGenerate }: {
  label: string; helper: string; rows: number; multiline: boolean;
  value: string; origin?: string; busy: boolean;
  onChange: (v: string) => void; onGenerate: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {label} {origin === "ai" && <span className="ml-1.5 text-accent normal-case tracking-normal">· AI draft</span>}
        </Label>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={onGenerate} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {value?.trim() ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {multiline ? (
        <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={helper} className="text-sm" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={helper} className="text-sm" />
      )}
      <p className="text-[10px] text-muted-foreground">{helper}</p>
    </div>
  );
}

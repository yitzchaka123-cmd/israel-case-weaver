// Panel C — Generate barcode (EAN-13), QR codes, and back-of-box image.
// The AI image is generated with explicit reserved zones, then the barcode,
// primary QR, secondary QRs, company logo, and address/legal/footer strip are
// baked on client-side via bakeCover.ts after the image lands.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, Copy, ExternalLink, Loader2, Barcode as BarcodeIcon,
  Image as ImageIcon, RefreshCw, Trash2, Wand2, QrCode, Plus, Star, Building2,
} from "lucide-react";
import { toast } from "sonner";
import { ean13ToPngBlob, ean13ToSvg, generateEan13 } from "./ean13";
import { createQrPngBlob } from "./qr";
import { bakeBackCover } from "./bakeCover";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { ImagePromptAssistant } from "@/components/ImagePromptAssistant";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { useProjectNotifications } from "@/features/project/notifications/useProjectNotifications";
import { fireBackgroundImage } from "@/features/project/fireBackgroundImage";

type OutputType = "image" | "document" | "both";

const OUTPUT_TYPES: { value: OutputType; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "document", label: "Document/file" },
  { value: "both", label: "Both" },
];

interface Marketing {
  project_id: string;
  front_subtext: string | null;
  back_headline: string | null;
  back_body: string | null;
  back_cover_prompt: string | null;
  tagline: string | null;
  barcode_value: string | null;
  barcode_url: string | null;
  back_cover_url: string | null;
  qr_code_url: string | null;
  mini_movie_url: string | null;
}

interface MediaAsset {
  id: string;
  category: string;
  title: string | null;
  url: string | null;
  prompt: string | null;
  created_at: string;
  model: string | null;
  effective_model: string | null;
  fallback: string | null;
}

interface QrRow {
  id: string;
  project_id: string;
  label: string | null;
  target_url: string;
  qr_image_url: string | null;
  is_primary: boolean;
  position: number;
}

interface ProjectLite {
  title: string | null;
  subtitle: string | null;
  mystery_type: string | null;
  setting: string | null;
}

interface CompanyLite {
  company_name: string | null;
  logo_url: string | null;
  address: string | null;
  legal_text: string | null;
  warning_text: string | null;
  box_footer_line: string | null;
  manufactured_by: string | null;
  distributed_by: string | null;
  tagline: string | null;
}

const LAYOUT_SUFFIX = `

LAYOUT REQUIREMENTS (these are PRINT-CRITICAL — overlays will be added later):
- Vertical, 3:4 print-ready canvas, atmospheric, evocative.
- Genre-appropriate imagery; do NOT spoil the solution.
- Reserve a CLEAN UNTEXTURED rectangular area in the LOWER-RIGHT (~22% × 18%) for a barcode — keep it visually quiet.
- Reserve a CLEAN UNTEXTURED square area in the LOWER-LEFT (~20% × 20%) for a primary QR code with a small label below it.
- Reserve a CLEAN UNTEXTURED rectangular area at TOP-CENTER (~22% × 10%) for the company logo.
- Reserve a CLEAN UNTEXTURED horizontal strip across the BOTTOM (~100% × 8%) for the company address and legal text.
- Reserve negative space across the central body region for paragraph copy.
- No text rendered into the artwork itself — typography and brand marks are added in post.`;

export function BarcodeAndBackPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const [generatingBack, setGeneratingBack] = useState(false);
  const [generateCount, setGenerateCount] = useState<1 | 2 | 4>(4);
  const [backOutputType, setBackOutputType] = useState<OutputType>("image");
  const [backOrigin, setBackOrigin] = useState<{ requested: string | null; effective: string | null; fallback: string | null } | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [newQrLabel, setNewQrLabel] = useState("");
  const [newQrUrl, setNewQrUrl] = useState("");
  const [creatingQr, setCreatingQr] = useState(false);
  const seenBarcode = useRef<string | null>(null);
  const { create: createNotif } = useProjectNotifications(projectId);

  const { data: project } = useQuery({
    queryKey: ["project-back-cover-meta", projectId],
    queryFn: async (): Promise<ProjectLite | null> => {
      const { data } = await supabase
        .from("projects")
        .select("title, subtitle, mystery_type, setting")
        .eq("id", projectId)
        .maybeSingle();
      return (data as ProjectLite) ?? null;
    },
  });

  const { data: company } = useQuery({
    queryKey: ["company-profile-for-back", user?.id],
    queryFn: async (): Promise<CompanyLite | null> => {
      if (!user) return null;
      const { data } = await supabase
        .from("company_profiles")
        .select("company_name, logo_url, address, legal_text, warning_text, box_footer_line, manufactured_by, distributed_by, tagline")
        .eq("owner_id", user.id)
        .maybeSingle();
      return (data as CompanyLite) ?? null;
    },
    enabled: !!user,
  });

  const { data } = useQuery({
    queryKey: ["project-marketing-barcode", projectId],
    queryFn: async (): Promise<Marketing | null> => {
      const { data, error } = await supabase.from("project_marketing").select("*").eq("project_id", projectId).maybeSingle();
      if (error) throw error;
      return (data as Marketing) ?? null;
    },
  });

  useEffect(() => { setPromptDraft(data?.back_cover_prompt ?? ""); }, [data?.back_cover_prompt]);

  const persistPrompt = async (next: string) => {
    setPromptDraft(next);
    await supabase.from("project_marketing").upsert(
      { project_id: projectId, back_cover_prompt: next } as never,
      { onConflict: "project_id" },
    );
  };

  const { data: backAssets } = useQuery({
    queryKey: ["marketing-back-assets", projectId],
    queryFn: async (): Promise<MediaAsset[]> => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, category, title, url, prompt, created_at, model, effective_model, fallback")
        .eq("project_id", projectId)
        .eq("category", "marketing-back")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MediaAsset[];
    },
  });

  const { data: qrCodes } = useQuery({
    queryKey: ["project-qr-codes", projectId],
    queryFn: async (): Promise<QrRow[]> => {
      const { data, error } = await supabase
        .from("project_qr_codes")
        .select("id, project_id, label, target_url, qr_image_url, is_primary, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as QrRow[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`marketing-barcode-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_marketing", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["project-marketing-barcode", projectId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["marketing-back-assets", projectId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "project_qr_codes", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["project-qr-codes", projectId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  useEffect(() => {
    if (!data?.barcode_value) return;
    if (seenBarcode.current === data.barcode_value) return;
    if (seenBarcode.current === null) {
      seenBarcode.current = data.barcode_value;
      return;
    }
    seenBarcode.current = data.barcode_value;
  }, [data?.barcode_value]);

  // ----- Barcode -----
  const handleGenerateBarcode = async () => {
    setGeneratingBarcode(true);
    try {
      const code = generateEan13();
      const blob = await ean13ToPngBlob(code);
      const path = `${projectId}/marketing/barcode-${code}.png`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, blob, { upsert: true, contentType: "image/png" });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      const { error } = await supabase
        .from("project_marketing")
        .upsert({ project_id: projectId, barcode_value: code, barcode_url: pub.publicUrl } as never, { onConflict: "project_id" });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Barcode ${code} generated`);
      createNotif({
        kind: "barcode_generated",
        title: "Barcode is ready — generate the back cover next.",
        body: `EAN-13 ${code} is saved. Use the Back-of-box generator below to bake it into the artwork.`,
        starter_prompt: "Help me design the back-of-box layout around the new barcode.",
        created_by: "assistant",
      });
    } finally {
      setGeneratingBarcode(false);
    }
  };

  // ----- QR codes (multi) -----
  const handleAddQr = async () => {
    if (!newQrUrl.trim()) {
      toast.error("Paste a link first");
      return;
    }
    setCreatingQr(true);
    try {
      const blob = await createQrPngBlob(newQrUrl.trim());
      const path = `${projectId}/marketing/qr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, blob, { upsert: true, contentType: "image/png" });
      if (upErr) { toast.error(upErr.message); return; }
      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      const isFirst = (qrCodes ?? []).length === 0;
      const { error } = await supabase.from("project_qr_codes").insert({
        project_id: projectId,
        label: newQrLabel.trim() || null,
        target_url: newQrUrl.trim(),
        qr_image_url: pub.publicUrl,
        is_primary: isFirst,
        position: (qrCodes ?? []).length,
      } as never);
      if (error) { toast.error(error.message); return; }
      if (isFirst) {
        await supabase.from("project_marketing").upsert({
          project_id: projectId, qr_code_url: pub.publicUrl, mini_movie_url: newQrUrl.trim(),
        } as never, { onConflict: "project_id" });
      }
      setNewQrLabel("");
      setNewQrUrl("");
      toast.success("QR code added");
    } finally {
      setCreatingQr(false);
    }
  };

  const setPrimaryQr = async (qr: QrRow) => {
    await supabase.from("project_qr_codes").update({ is_primary: false } as never).eq("project_id", projectId);
    await supabase.from("project_qr_codes").update({ is_primary: true } as never).eq("id", qr.id);
    await supabase.from("project_marketing").upsert({
      project_id: projectId, qr_code_url: qr.qr_image_url, mini_movie_url: qr.target_url,
    } as never, { onConflict: "project_id" });
    toast.success("Primary QR updated");
  };

  const deleteQr = async (qr: QrRow) => {
    if (!confirm("Delete this QR code?")) return;
    await supabase.from("project_qr_codes").delete().eq("id", qr.id);
    if (qr.is_primary) {
      await supabase.from("project_marketing").upsert({
        project_id: projectId, qr_code_url: null, mini_movie_url: null,
      } as never, { onConflict: "project_id" });
    }
  };

  // ----- Back cover prompt + generation -----
  const buildPromptHint = (): string => [
    project?.title && `Title: ${project.title}`,
    project?.subtitle && `Subtitle: ${project.subtitle}`,
    project?.mystery_type && `Mystery type: ${project.mystery_type}`,
    project?.setting && `Setting: ${project.setting}`,
    data?.back_headline && `Back headline: ${data.back_headline}`,
    data?.tagline && `Tagline: ${data.tagline}`,
    company?.company_name && `Company: ${company.company_name}`,
    company?.tagline && `Company tagline: ${company.tagline}`,
  ].filter(Boolean).join(". ");

  const composeFinalPrompt = (draft: string): string => {
    const headline = data?.back_headline ?? "";
    const body = data?.back_body ?? "";
    const tagline = data?.tagline ?? "";
    return `Design a printable BACK-OF-BOX cover for a premium boxed murder-mystery game.

ART DIRECTION FROM THE WRITER:
${draft.trim() || "(no extra direction — use the headline + body below to set the tone)"}

HEADLINE (place prominently at top): "${headline}"

BODY COPY (reserve enough negative space for it; do NOT render this text):
"""
${body}
"""

${tagline ? `TAGLINE (small): "${tagline}"` : ""}${LAYOUT_SUFFIX}`;
  };

  const handleGenerateBack = async () => {
    if (!data?.barcode_url || !data?.back_body) {
      toast.error("Generate the barcode + write back-cover copy first.");
      return;
    }
    if (!promptDraft.trim()) {
      toast.error("Click Create prompt or write a prompt first.");
      return;
    }
    setGeneratingBack(true);
    try {
      const composedPrompt = composeFinalPrompt(promptDraft);
      let kicked = 0;
      if (backOutputType === "image" || backOutputType === "both") {
        const modelOverride = getStoredImageModel("marketing-back", "chatgpt-image-2");
        const quality = getStoredImageQuality("marketing-back", "medium");
        const results = await Promise.all(
          Array.from({ length: generateCount }).map((_, i) => fireBackgroundImage({
            projectId,
            target: "media",
            category: "marketing-back",
            prompt: `${composedPrompt}\n\nVariation ${i + 1}: use a distinct composition, color balance, and focal image while preserving the reserved zones.`,
            title: `Back of box option ${i + 1}`,
            modelOverride,
            quality,
            aspect: "portrait",
          })),
        );
        const failures = results.filter((r) => !r.ok);
        kicked = results.length - failures.length;
        if (failures.length) {
          toast.error(failures[0].error ?? "Some back-cover jobs failed to start", { duration: 10000 });
          if (backOutputType === "image" && kicked === 0) return;
        }
      }
      if (backOutputType === "document" || backOutputType === "both") {
        await supabase.from("media_assets").insert({ project_id: projectId, category: "marketing-back", title: "Back of box document prompt", prompt: composedPrompt, provider: "direct-model-file", asset_type: "document", document_format: "pdf", generation_mode: "direct_model_file", status: "failed", error_message: "Create a document row to generate a real file directly with the selected document model." } as never);
      }
      if (kicked > 0) {
        toast.success(`Generating ${kicked} back-cover option${kicked === 1 ? "" : "s"} — barcode, QR & company info will be stamped on automatically.`);
      } else if (backOutputType === "document") {
        toast.success("Back-cover document prompt saved");
      }
    } finally {
      setGeneratingBack(false);
    }
  };

  // After a fresh marketing-back row arrives, bake all the elements onto it.
  const bakingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!data?.barcode_url) return;
    const list = backAssets ?? [];
    const todo = list.filter((a) => a.url && !a.url.includes("back-final-") && !bakingRef.current.has(a.id));
    if (todo.length === 0) return;
    const primary = (qrCodes ?? []).find((q) => q.is_primary && q.qr_image_url) ?? null;
    const secondaries = (qrCodes ?? []).filter((q) => !q.is_primary && q.qr_image_url);
    todo.forEach((asset) => {
      bakingRef.current.add(asset.id);
      void (async () => {
        try {
          const finalUrl = await bakeBackCover({
            projectId,
            baseImageUrl: asset.url!,
            barcodeUrl: data.barcode_url,
            primaryQr: primary ? { url: primary.qr_image_url, label: primary.label } : null,
            secondaryQrs: secondaries.map((q) => ({ url: q.qr_image_url, label: q.label })),
            logoUrl: company?.logo_url ?? null,
            companyName: company?.company_name ?? null,
            address: company?.address ?? null,
            legalText: company?.legal_text ?? null,
            warningText: company?.warning_text ?? null,
            footerLine: company?.box_footer_line ?? null,
          });
          await supabase.from("media_assets").update({ url: finalUrl }).eq("id", asset.id);
          await supabase.from("project_marketing").upsert({
            project_id: projectId,
            back_cover_url: finalUrl,
          } as never, { onConflict: "project_id" });
          setBackOrigin({
            requested: asset.model ?? null,
            effective: asset.effective_model ?? null,
            fallback: asset.fallback ?? null,
          });
        } catch (e) {
          toast.error("Generated, but back-cover overlay failed: " + (e instanceof Error ? e.message : "unknown"));
          bakingRef.current.delete(asset.id);
        }
      })();
    });
  }, [backAssets, data?.barcode_url, qrCodes, company, projectId]);

  const barcodeReady = !!data?.barcode_url;
  const copyReady = !!data?.back_body && !!data?.back_headline;
  const candidates = backAssets ?? [];

  const setActiveBackCover = async (url: string) => {
    const { error } = await supabase.from("project_marketing").upsert({ project_id: projectId, back_cover_url: url } as never, { onConflict: "project_id" });
    if (error) return toast.error(error.message);
    toast.success("Back cover selected");
  };

  const deleteCandidate = async (asset: MediaAsset) => {
    if (!confirm("Delete this back-cover candidate?")) return;
    const { error } = await supabase.from("media_assets").delete().eq("id", asset.id);
    if (error) return toast.error(error.message);
    if (asset.url && asset.url === data?.back_cover_url) {
      const next = candidates.find((a) => a.id !== asset.id && a.url)?.url ?? null;
      await supabase.from("project_marketing").upsert({ project_id: projectId, back_cover_url: next } as never, { onConflict: "project_id" });
    }
    toast.success("Candidate deleted");
  };

  const copyPrompt = async (prompt: string | null) => {
    if (!prompt) return toast.error("No prompt saved for this image");
    await navigator.clipboard.writeText(prompt);
    toast.success("Prompt copied");
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-5">
      <div>
        <h3 className="font-display text-xl">Barcode, QR & back of box</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Generate the EAN-13, add as many QR codes as you need, then generate the back cover — barcode, primary QR, company logo, and address strip are all baked on automatically.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Barcode */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
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
          <Button onClick={handleGenerateBarcode} disabled={generatingBarcode} variant={barcodeReady ? "outline" : "default"} size="sm" className="w-full gap-1.5">
            {generatingBarcode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : barcodeReady ? <RefreshCw className="h-3.5 w-3.5" /> : <BarcodeIcon className="h-3.5 w-3.5" />}
            {barcodeReady ? "Generate new barcode" : "Generate barcode"}
          </Button>
        </div>

        {/* QR codes */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <QrCode className="h-4 w-4" /> QR codes
          </div>
          <p className="text-[11px] text-muted-foreground">
            Add a link → we generate the QR. The <Star className="inline h-3 w-3" /> primary QR is baked large on the back cover; the others appear as a small strip.
          </p>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                value={newQrLabel}
                onChange={(e) => setNewQrLabel(e.target.value)}
                placeholder="Label (e.g. Mini movie)"
                className="text-sm h-9"
              />
              <span />
              <Input
                value={newQrUrl}
                onChange={(e) => setNewQrUrl(e.target.value)}
                placeholder="https://…"
                className="text-sm h-9"
              />
              <Button onClick={handleAddQr} disabled={creatingQr || !newQrUrl.trim()} size="sm" className="gap-1.5 h-9">
                {creatingQr ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </Button>
            </div>
          </div>
          {(qrCodes ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
              No QR codes yet. The first one you add becomes the primary.
            </div>
          ) : (
            <div className="space-y-2">
              {(qrCodes ?? []).map((qr) => (
                <div key={qr.id} className="flex items-center gap-3 rounded-lg border bg-background p-2">
                  {qr.qr_image_url ? (
                    <img src={qr.qr_image_url} alt={qr.label ?? "QR"} className="h-12 w-12 rounded border bg-white object-contain p-1" />
                  ) : (
                    <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center">
                      <QrCode className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{qr.label ?? "Untitled QR"}</div>
                    <a href={qr.target_url} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:underline truncate block">
                      {qr.target_url}
                    </a>
                  </div>
                  <Button size="sm" variant={qr.is_primary ? "secondary" : "ghost"} className="h-7 px-2 gap-1 text-[11px]" onClick={() => !qr.is_primary && setPrimaryQr(qr)}>
                    <Star className={`h-3 w-3 ${qr.is_primary ? "fill-current" : ""}`} />
                    {qr.is_primary ? "Primary" : "Make primary"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteQr(qr)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Back cover generator */}
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ImageIcon className="h-4 w-4" /> Back cover
        </div>
        <div className="grid lg:grid-cols-[2fr_3fr] gap-4">
          <div className="group aspect-[3/4] bg-muted rounded-lg overflow-hidden flex items-center justify-center relative">
            {data?.back_cover_url ? (
              <>
                <img src={data.back_cover_url} alt="Back of box" className="w-full h-full object-cover" />
                {backOrigin && (backOrigin.effective || backOrigin.requested) && (
                  <AiOriginBadge hoverOnly info={backOrigin} />
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground text-center px-4">
                {!barcodeReady
                  ? "Generate a barcode first."
                  : !copyReady
                    ? "Write box copy (headline + body) first."
                    : "Click Generate to render the back cover."}
              </span>
            )}
          </div>
          <div className="space-y-3">
            <ImagePromptAssistant
              projectId={projectId}
              surface="cover"
              category="marketing-back"
              targetId={projectId}
              hint={buildPromptHint()}
              prompt={promptDraft}
              onChange={persistPrompt}
            />
            <ImageModelPicker surface="marketing-back" defaultModel="chatgpt-image-2" />
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-surface/70 p-2">
              <span className="text-xs font-medium text-muted-foreground">Output type</span>
              <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                {OUTPUT_TYPES.map((option) => (
                  <button key={option.value} type="button" onClick={() => setBackOutputType(option.value)}
                    className={`h-7 rounded px-2 text-xs font-medium transition ${backOutputType === option.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-surface/70 p-2">
              <span className="text-xs font-medium text-muted-foreground">Generate options</span>
              <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                {([1, 2, 4] as const).map((count) => (
                  <button key={count} type="button" onClick={() => setGenerateCount(count)}
                    className={`h-7 min-w-8 rounded px-2 text-xs font-medium transition ${generateCount === count ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {count}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={handleGenerateBack} disabled={generatingBack || !barcodeReady || !copyReady || !promptDraft.trim()} size="sm" className="w-full gap-1.5">
              {generatingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {data?.back_cover_url ? "Generate more back-cover options" : "Generate back-cover options"}
            </Button>
          </div>
        </div>

        {/* Mini company-summary card so the user sees what gets baked on */}
        <div className="rounded-lg border bg-background p-3 flex items-center gap-3">
          <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {company?.logo_url ? (
              <img src={company.logo_url} alt="logo" className="w-full h-full object-contain" />
            ) : (
              <Building2 className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-[11px] text-muted-foreground leading-relaxed">
            <div className="text-foreground font-medium text-xs truncate">{company?.company_name ?? "No company profile yet"}</div>
            <div className="truncate">{[company?.address, company?.box_footer_line, company?.warning_text].filter(Boolean).join("  ·  ") || "Add your address & legal text in Settings → Company profile."}</div>
          </div>
        </div>
      </div>

      {/* Candidates */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium">Back-cover candidates</h4>
          <span className="text-xs text-muted-foreground">{candidates.length} saved</span>
        </div>
        {candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Generated back-cover options will appear here.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {candidates.map((asset) => {
              const active = !!asset.url && asset.url === data?.back_cover_url;
              return (
                <div key={asset.id} className="rounded-xl border bg-surface overflow-hidden">
                  <div className="group aspect-[3/4] bg-muted relative">
                    {asset.url ? (
                      <img src={asset.url} alt={asset.title ?? "Back-cover candidate"} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
                    )}
                    {active && (
                      <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-[10px] font-medium text-accent-foreground">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </div>
                    )}
                    {(asset.model || asset.effective_model) && (
                      <AiOriginBadge hoverOnly info={{ requested: asset.model, effective: asset.effective_model ?? asset.model, fallback: asset.fallback ?? "none" }} />
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="text-xs font-medium truncate">{asset.title ?? "Back of box"}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button size="sm" variant={active ? "secondary" : "outline"} className="h-8 text-xs" disabled={!asset.url || active} onClick={() => asset.url && setActiveBackCover(asset.url)}>
                        Use
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => copyPrompt(asset.prompt)}>
                        <Copy className="h-3 w-3" /> Prompt
                      </Button>
                      {asset.url && (
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" asChild>
                          <a href={asset.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /> Open</a>
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => deleteCandidate(asset)}>
                        <Trash2 className="h-3 w-3" /> Delete
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

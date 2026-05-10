// Panel A — shows the project cover prominently and lets the user generate
// additional marketing images (back of box, marketing-extra). Uses the new
// ImagePromptAssistant + history strip + FinalAssetPicker stack so the cover
// here stays in sync with Overview.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ImagePromptAssistant } from "@/components/ImagePromptAssistant";
import { ImageHistoryStrip, type ImageHistoryRow } from "@/components/ImageHistoryStrip";
import { FinalAssetPicker } from "@/components/FinalAssetPicker";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { DownloadButton } from "@/components/DownloadButton";
import { fireBackgroundImage } from "@/features/project/fireBackgroundImage";
import { useBatchProgress } from "./BatchProgressContext";
import { bakeFrontCover } from "./bakeCover";
import { useActiveCompanyProfile } from "@/lib/useActiveCompanyProfile";
import { composeFrontPrompt as buildFrontPrompt, composeBackPrompt, composeCoverPairPrompt } from "./composePrompts";

import { Copy, Plus, Trash2, Image as ImageIcon, ExternalLink, Loader2, Sparkles, Wand2, AlertTriangle, Download, Star, Eye } from "lucide-react";
import { downloadAsset, slugify } from "@/lib/utils";
import { toast } from "sonner";

type OutputType = "image" | "document" | "both";

const OUTPUT_TYPES: { value: OutputType; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "document", label: "Document/file" },
  { value: "both", label: "Both" },
];

interface MediaAsset {
  id: string;
  category: string;
  title: string | null;
  url: string | null;
  prompt: string | null;
  created_at: string;
  mime_type: string | null;
  model: string | null;
  effective_model: string | null;
  fallback: string | null;
}

const MARKETING_CATEGORIES = ["cover", "back", "marketing-back", "marketing-extra"];



export function CoverAndVisuals({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  
  const batch = useBatchProgress();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newHint, setNewHint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [rebaking, setRebaking] = useState(false);
  const [coverOutputType, setCoverOutputType] = useState<OutputType>("image");
  const [extraOutputType, setExtraOutputType] = useState<OutputType>("image");
  const [promptPreview, setPromptPreview] = useState<{ text: string; refs: { url: string; label: string }[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data: company } = useActiveCompanyProfile(projectId);

  const { data: project } = useQuery({
    queryKey: ["project-cover-only", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("title, cover_image_url, uploaded_cover_url, cover_active_version, cover_prompt, cover_effective_model, cover_fallback, ai_provider_images, mystery_type, setting, subtitle, genre, year, cover_reference_url, cover_reference_notes")
        .eq("id", projectId)
        .maybeSingle();
      return data;
    },
  });

  const setCoverReference = async (url: string | null) => {
    await supabase.from("projects").update({ cover_reference_url: url } as never).eq("id", projectId);
    qc.invalidateQueries({ queryKey: ["project-cover-only", projectId] });
  };

  const { data: marketing } = useQuery({
    queryKey: ["project-marketing-pair", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("project_marketing")
        .select("front_subtext, tagline, back_headline, back_body, back_cover_prompt, back_teaser, back_whats_in_box, back_specs, back_footer_text, barcode_value, barcode_url, back_cover_url")
        .eq("project_id", projectId)
        .maybeSingle();
      return data;
    },
  });

  const { data: qrCodes } = useQuery({
    queryKey: ["project-qr-codes-cover", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("project_qr_codes")
        .select("id, label, target_url, qr_image_url, is_primary, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true });
      return data ?? [];
    },
  });

  const { data: assets } = useQuery({
    queryKey: ["marketing-assets", projectId],
    queryFn: async (): Promise<MediaAsset[]> => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, category, title, url, prompt, created_at, mime_type, model, effective_model, fallback")
        .eq("project_id", projectId)
        .in("category", MARKETING_CATEGORIES)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MediaAsset[];
    },
  });

  const { data: coverHistory } = useQuery({
    queryKey: ["project-cover-history", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, url, preview_url, model, effective_model, provider, fallback, created_at")
        .eq("project_id", projectId)
        .eq("source_project_cover", true)
        .not("url", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as ImageHistoryRow[];
    },
  });

  const [coverPromptDraft, setCoverPromptDraft] = useState<string>("");
  useEffect(() => { setCoverPromptDraft(project?.cover_prompt ?? ""); }, [project?.cover_prompt]);

  const persistCoverPrompt = async (next: string) => {
    setCoverPromptDraft(next);
    await supabase.from("projects").update({ cover_prompt: next }).eq("id", projectId);
  };

  const setCoverActiveVersion = async (v: string) => {
    await supabase.from("projects").update({ cover_active_version: v }).eq("id", projectId);
    qc.invalidateQueries({ queryKey: ["project-cover-only", projectId] });
  };

  const restoreCoverFromHistory = async (item: ImageHistoryRow) => {
    if (!item.url) return;
    await supabase.from("projects").update({
      cover_image_url: item.url,
      cover_effective_model: item.effective_model ?? item.model,
      cover_fallback: item.fallback ?? null,
      cover_active_version: "generated",
    }).eq("id", projectId);
    qc.invalidateQueries({ queryKey: ["project-cover-only", projectId] });
    toast.success("Cover restored as active");
  };

  useEffect(() => {
    const ch = supabase
      .channel(`marketing-assets-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["marketing-assets", projectId] });
        qc.invalidateQueries({ queryKey: ["project-cover-history", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["project-cover-only", projectId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  // Auto-bake title/subtitle/logo onto a freshly generated raw cover.
  const bakingFrontRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const url = project?.cover_image_url;
    if (!url || url.includes("cover-final-") || bakingFrontRef.current.has(url)) return;
    if (!project?.title && !project?.subtitle && !company?.logo_url && !marketing?.front_subtext && !marketing?.tagline && !marketing?.back_specs) return;
    bakingFrontRef.current.add(url);
    void (async () => {
      try {
        const finalUrl = await bakeFrontCover({
          projectId,
          baseImageUrl: url,
          title: project?.title ?? null,
          subtitle: project?.subtitle ?? null,
          tagline: marketing?.tagline ?? null,
          logoUrl: company?.logo_url ?? null,
          bottomParagraph: marketing?.front_subtext ?? null,
          specs: marketing?.back_specs ?? null,
        });
        await supabase.from("projects").update({ cover_image_url: finalUrl }).eq("id", projectId);
      } catch (e) {
        console.warn("Front cover bake failed", e);
        bakingFrontRef.current.delete(url);
      }
    })();
  }, [project?.cover_image_url, project?.title, project?.subtitle, company?.logo_url, marketing?.front_subtext, marketing?.tagline, marketing?.back_specs, projectId]);

  const handleRebakeCover = async () => {
    if (!project?.cover_image_url) return;
    setRebaking(true);
    try {
      const finalUrl = await bakeFrontCover({
        projectId,
        baseImageUrl: project.cover_image_url,
        title: project?.title ?? null,
        subtitle: project?.subtitle ?? null,
        tagline: marketing?.tagline ?? null,
        logoUrl: company?.logo_url ?? null,
        bottomParagraph: marketing?.front_subtext ?? null,
        specs: marketing?.back_specs ?? null,
      });
      await supabase.from("projects").update({ cover_image_url: finalUrl }).eq("id", projectId);
      toast.success("Cover re-baked with latest title, tagline, specs & logo");
    } catch (e) {
      toast.error("Re-bake failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setRebaking(false);
    }
  };

  const cover = project?.cover_image_url;
  const extras = (assets ?? []).filter((a) => a.category === "marketing-extra" || a.category === "back" || a.category === "marketing-back");

  // Combined front+back validation — both halves must be ready before we
  // fire the single gpt-image-2 call.
  const frontMissing: string[] = [];
  if (!project?.title?.trim()) frontMissing.push("Title (Overview)");
  if (!marketing?.barcode_url) frontMissing.push("Barcode (Barcode & Back)");
  if (!(qrCodes ?? []).some((q) => q.is_primary && q.qr_image_url)) frontMissing.push("Primary QR (Barcode & Back)");
  if (!marketing?.back_headline) frontMissing.push("Back headline (Box Text)");
  if (!marketing?.back_body) frontMissing.push("Back body copy (Box Text)");
  if (!company?.company_name) frontMissing.push("Company name (Settings)");
  if (!company?.logo_url) frontMissing.push("Company logo (Settings)");
  const frontReady = frontMissing.length === 0;

  const houseDefaultRef = (company?.reference_covers ?? []).find((r) => r.is_default) ?? null;
  const effectiveReferenceUrl = project?.cover_reference_url || houseDefaultRef?.url || null;

  const buildPromptBundle = async (basePrompt: string) => {
    const { data: sceneRows } = await supabase
      .from("media_assets")
      .select("url")
      .eq("project_id", projectId)
      .eq("category", "in-game-scene")
      .not("url", "is", null)
      .order("created_at", { ascending: false })
      .limit(4);
    const sceneUrls = (sceneRows ?? []).map((r) => r.url).filter((u): u is string => !!u);
    const primaryQr = (qrCodes ?? []).find((q) => q.is_primary && q.qr_image_url);
    const barcodeUrl = marketing?.barcode_url ?? null;

    const frontHalf = buildFrontPrompt({ basePrompt, project, marketing, company });
    const backHalf = composeBackPrompt({
      draft: marketing?.back_cover_prompt ?? "",
      back: marketing,
      company,
      qrCodes: qrCodes ?? [],
    });
    const combinedPrompt = composeCoverPairPrompt({
      frontPrompt: frontHalf,
      backPrompt: backHalf,
      publisherName: company?.company_name ?? null,
      hasReference: !!effectiveReferenceUrl,
      sceneCount: sceneUrls.length,
      hasQrRef: !!primaryQr?.qr_image_url,
      hasBarcodeRef: !!barcodeUrl,
    });

    const refs: { url: string; label: string }[] = [];
    if (effectiveReferenceUrl) refs.push({ url: effectiveReferenceUrl, label: `Brand reference (${company?.company_name ?? "house style"})` });
    sceneUrls.forEach((u, i) => refs.push({ url: u, label: `In-game scene ${i + 1}` }));
    if (primaryQr?.qr_image_url) refs.push({ url: primaryQr.qr_image_url, label: `Primary QR (${primaryQr.label ?? "scan"})` });
    if (barcodeUrl) refs.push({ url: barcodeUrl, label: `EAN-13 barcode${marketing?.barcode_value ? ` (${marketing.barcode_value})` : ""}` });

    return { combinedPrompt, sceneUrls, primaryQrUrl: primaryQr?.qr_image_url ?? null, barcodeUrl, refs };
  };

  const handleViewPrompt = async () => {
    setPreviewLoading(true);
    try {
      const { combinedPrompt, refs } = await buildPromptBundle(coverPromptDraft);
      setPromptPreview({ text: combinedPrompt, refs });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build prompt");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerateCover = async (prompt: string) => {
    if (!frontReady) {
      toast.error(`Missing: ${frontMissing.join(", ")}.`, { duration: 10000 });
      return;
    }
    setGeneratingCover(true);
    try {
      const { combinedPrompt, sceneUrls, primaryQrUrl, barcodeUrl } = await buildPromptBundle(prompt);

      const quality = getStoredImageQuality("marketing-cover", "high");
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cover-pair`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          projectId,
          combinedPrompt,
          referenceImageUrl: effectiveReferenceUrl,
          referenceLabel: company?.company_name ?? null,
          inGameSceneUrls: sceneUrls,
          qrImageUrl: primaryQrUrl,
          barcodeImageUrl: barcodeUrl,
          quality,
        }),
      });
      const json = await resp.json().catch(() => ({} as Record<string, unknown>));
      if (!resp.ok) {
        toast.error((json.error as string) ?? `Could not start (${resp.status})`, { duration: 10000 });
        return;
      }
      const slots = [
        { id: json.frontJobId as string, label: "Front cover" },
        { id: json.backJobId as string, label: "Back cover" },
      ].filter((s) => Boolean(s.id));
      if (slots.length) batch?.start(slots, "Front + back cover");
      const sceneNote = sceneUrls.length ? ` (with ${sceneUrls.length} in-game scenes attached)` : "";
      toast.success(`Generating front + back together${sceneNote} — ~60–90s. You can leave this page.`);
      qc.invalidateQueries({ queryKey: ["project-cover-only", projectId] });
    } finally {
      setGeneratingCover(false);
    }
  };

  const handleGenerate = async (prompt: string) => {
    setGenerating(true);
    try {
      if (extraOutputType === "image" || extraOutputType === "both") {
        const modelOverride = getStoredImageModel("marketing-cover", "chatgpt-image-2");
        const quality = getStoredImageQuality("marketing-cover", "high");
        const result = await fireBackgroundImage({
          projectId,
          target: "media",
          category: "marketing-extra",
          prompt,
          title: newTitle || "Marketing image",
          modelOverride,
          quality,
        });
        if (!result.ok) {
          toast.error(result.error ?? "Could not start image generation", { duration: 10000 });
          if (extraOutputType === "image") return;
        } else if (result.jobId) {
          batch?.start([{ id: result.jobId, label: newTitle || "Marketing image" }], newTitle || "Marketing image");
        }
      }
      if (extraOutputType === "document" || extraOutputType === "both") {
        await supabase.from("media_assets").insert({ project_id: projectId, category: "marketing-extra", title: newTitle || "Marketing document prompt", prompt, provider: "direct-model-file", asset_type: "document", document_format: "pdf", generation_mode: "direct_model_file", status: "failed", error_message: "Create a document row to generate a real file directly with the selected document model." } as never);
      }
      toast.success(extraOutputType === "document" ? "Marketing document prompt saved" : "Generating marketing image in background — feel free to leave this page");
      setNewTitle("");
      setNewHint("");
      setAdding(false);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this marketing image?")) return;
    const { error } = await supabase.from("media_assets").delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  const handleCopyPrompt = async (prompt: string | null) => {
    if (!prompt) return toast.error("No prompt saved for this image");
    await navigator.clipboard.writeText(prompt);
    toast.success("Prompt copied");
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-xl">Cover & visuals</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            The cover from your Overview, plus any extra marketing images.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
          Add marketing image
        </Button>
      </div>

      <div className="grid lg:grid-cols-[3fr_2fr] gap-5">
        <div className="rounded-xl border bg-muted/30 overflow-hidden">
          <div className="group aspect-[3/4] bg-muted relative">
            {cover ? (
              <>
                <img src={cover} alt={project?.title ?? "Cover"} className="w-full h-full object-cover" />
                {(project?.cover_effective_model || project?.cover_fallback) && (
                  <AiOriginBadge
                    hoverOnly
                    info={{
                      requested: project?.ai_provider_images ?? null,
                      effective: project?.cover_effective_model ?? null,
                      fallback: project?.cover_fallback ?? "none",
                    }}
                  />
                )}
                <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <DownloadButton url={cover} title={`${project?.title ?? "cover"}-front`} />
                </span>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2 text-center px-6">
                <ImageIcon className="h-8 w-8" />
                <p className="text-sm">No cover yet — generate one in <strong>Overview</strong>.</p>
              </div>
            )}
          </div>
          <div className="px-4 py-3 text-xs text-muted-foreground border-t flex items-center justify-between gap-2">
            <span><span className="font-medium text-foreground">Front cover</span> · title, subtitle & logo are baked on automatically</span>
            {cover && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={handleRebakeCover} disabled={rebaking}>
                {rebaking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                Re-bake
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-surface/60 p-4 space-y-3">
          <div>
            <h4 className="font-display text-lg">Generate front + back cover</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              One <strong>gpt-image-2</strong> call returns BOTH the front and back of the box together
              so they share palette, illustration style and brand fingerprint as siblings on a shelf.
            </p>
          </div>
          {!frontReady && (
            <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-amber-800 dark:text-amber-200">Need these before generating both covers:</div>
                <ul className="text-amber-800/80 dark:text-amber-200/80 mt-0.5 list-disc list-inside">
                  {frontMissing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            </div>
          )}
          {(company?.reference_covers ?? []).length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Reference cover (publisher gallery)</Label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setCoverReference(null)}
                  className={`shrink-0 h-20 w-16 rounded border-2 text-[10px] font-medium flex items-center justify-center text-center px-1 transition ${!project?.cover_reference_url ? "border-accent bg-accent/10 text-accent" : "border-muted bg-muted/30 text-muted-foreground hover:border-foreground/40"}`}
                >
                  {houseDefaultRef ? "Use house default" : "No reference"}
                </button>
                {(company!.reference_covers ?? []).map((ref, i) => {
                  const selected = project?.cover_reference_url === ref.url;
                  const isHouse = !!ref.is_default;
                  return (
                    <button
                      key={ref.url + i}
                      type="button"
                      onClick={() => setCoverReference(ref.url)}
                      title={`${ref.label ?? `Reference ${i + 1}`}${isHouse ? " (house default)" : ""}`}
                      className={`relative shrink-0 h-20 w-16 rounded border-2 overflow-hidden transition ${selected ? "border-accent ring-2 ring-accent/30" : isHouse ? "border-accent/60" : "border-muted hover:border-foreground/40"}`}
                    >
                      <img src={ref.url} alt={ref.label ?? `Reference ${i + 1}`} className="w-full h-full object-cover" />
                      {isHouse && (
                        <span className="absolute top-0.5 right-0.5 bg-accent text-accent-foreground rounded-full h-4 w-4 flex items-center justify-center" title="House default">
                          <Star className="h-2.5 w-2.5 fill-current" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {effectiveReferenceUrl
                  ? "Reference is sent as a real vision input to gpt-image-2 — both halves of the pair inherit its style."
                  : "No reference selected — pick one for tighter brand continuity."}
              </p>
            </div>
          )}
          <ImagePromptAssistant
            projectId={projectId}
            surface="cover"
            category="cover"
            targetId={projectId}
            hint={[project?.title && `Title: ${project.title}`, project?.subtitle && `Subtitle: ${project.subtitle}`, project?.mystery_type && `Mystery type: ${project.mystery_type}`, project?.setting && `Setting: ${project.setting}`].filter(Boolean).join(". ")}
            prompt={coverPromptDraft}
            onChange={persistCoverPrompt}
          />
          <div className="flex gap-2">
            <Button onClick={() => handleGenerateCover(coverPromptDraft)} disabled={generatingCover || !coverPromptDraft.trim() || !frontReady} className="flex-1 gap-2">
              {generatingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate front + back cover
            </Button>
            <Button variant="outline" onClick={handleViewPrompt} disabled={previewLoading || !coverPromptDraft.trim()} className="gap-2">
              {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              View prompt
            </Button>
          </div>
          <ImageHistoryStrip
            items={coverHistory ?? []}
            currentUrl={project?.cover_image_url ?? null}
            onRestore={restoreCoverFromHistory}
            title="Cover history"
          />
          {(project?.cover_image_url || project?.uploaded_cover_url) && (
            <FinalAssetPicker
              value={project?.cover_active_version ?? "generated"}
              onChange={setCoverActiveVersion}
              generatedUrl={project?.cover_image_url ?? null}
              uploadedUrl={project?.uploaded_cover_url ?? null}
              generatedLabel="Generated cover"
              uploadedLabel="Uploaded cover"
            />
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-display text-lg">Marketing asset gallery</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Supporting visuals, back-cover candidates, and promo art.</p>
          </div>
        </div>
          {extras.length === 0 ? (
            <div className="border-2 border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">
              No extra marketing images yet. Click <em>Add marketing image</em> to generate one.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {extras.map((a) => (
                <div key={a.id} className="group rounded-xl border overflow-hidden bg-muted relative">
                  <div className="aspect-square">
                    {a.url ? (
                      <img src={a.url} alt={a.title ?? ""} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                    )}
                  </div>
                  {(a.model || a.effective_model) && (
                    <AiOriginBadge
                      hoverOnly
                      info={{
                        requested: a.model,
                        effective: a.effective_model ?? a.model,
                        fallback: a.fallback ?? "none",
                      }}
                    />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-2">
                    <span className="text-[10px] text-white truncate flex-1">
                      {a.category === "marketing-back" ? "Back-cover candidate" : (a.title ?? a.category)}
                    </span>
                    <button onClick={() => handleCopyPrompt(a.prompt)} className="text-white/90 hover:text-white" aria-label="Copy prompt">
                      <Copy className="h-3 w-3" />
                    </button>
                    {a.url && (
                      <button onClick={() => downloadAsset(a.url!, slugify(a.title ?? a.category))} className="text-white/90 hover:text-white" aria-label="Download">
                        <Download className="h-3 w-3" />
                      </button>
                    )}
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-white/90 hover:text-white">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <button onClick={() => handleDelete(a.id)} className="text-white/90 hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {adding && (
        <div className="rounded-xl border bg-surface/60 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Title</Label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Side panel art" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Steering hint</Label>
              <Input value={newHint} onChange={(e) => setNewHint(e.target.value)} placeholder="e.g. moody close-up of the locket" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Image model</Label>
            <div className="max-w-xs">
              <ImageModelPicker surface="marketing-cover" defaultModel="chatgpt-image-2" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Output type</Label>
            <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
              {OUTPUT_TYPES.map((option) => (
                <button key={option.value} type="button" onClick={() => setExtraOutputType(option.value)} className={`h-8 rounded px-3 text-xs font-medium transition ${extraOutputType === option.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <ExtraPromptBlock
            projectId={projectId}
            hint={newHint}
            onGenerate={handleGenerate}
            generating={generating}
          />
          {generating && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Generating…
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ExtraPromptBlock({ projectId, hint, onGenerate, generating }: { projectId: string; hint: string; onGenerate: (p: string) => void | Promise<void>; generating: boolean }) {
  const [prompt, setPrompt] = useState("");
  return (
    <div className="space-y-2">
      <ImagePromptAssistant
        projectId={projectId}
        surface="media"
        category="marketing-extra"
        hint={hint}
        prompt={prompt}
        onChange={setPrompt}
      />
      <Button onClick={() => onGenerate(prompt)} disabled={generating || !prompt.trim()} className="gap-2">
        {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Generate marketing image
      </Button>
    </div>
  );
}

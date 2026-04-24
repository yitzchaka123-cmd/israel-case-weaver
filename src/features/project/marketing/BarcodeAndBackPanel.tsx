// Panel C — Generate barcode (EAN-13) and back-of-box image. Barcode is
// rendered client-side, uploaded to the media bucket, and stamped onto the
// back-of-box generation as a final compositing step (also client-side).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Copy, ExternalLink, Loader2, Barcode as BarcodeIcon, Image as ImageIcon, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { ean13ToPngBlob, ean13ToSvg, generateEan13 } from "./ean13";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { useProjectNotifications } from "@/features/project/notifications/useProjectNotifications";

interface Marketing {
  project_id: string;
  front_subtext: string | null;
  back_headline: string | null;
  back_body: string | null;
  tagline: string | null;
  barcode_value: string | null;
  barcode_url: string | null;
  back_cover_url: string | null;
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

async function fetchAsImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now();
  });
}

export function BarcodeAndBackPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const [generatingBack, setGeneratingBack] = useState(false);
  const [generateCount, setGenerateCount] = useState<1 | 2 | 4>(4);
  const [backOrigin, setBackOrigin] = useState<{ requested: string | null; effective: string | null; fallback: string | null } | null>(null);
  const seenBarcode = useRef<string | null>(null);
  const { create: createNotif } = useProjectNotifications(projectId);

  const { data } = useQuery({
    queryKey: ["project-marketing-barcode", projectId],
    queryFn: async (): Promise<Marketing | null> => {
      const { data, error } = await supabase.from("project_marketing").select("*").eq("project_id", projectId).maybeSingle();
      if (error) throw error;
      return (data as Marketing) ?? null;
    },
  });

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

  useEffect(() => {
    const ch = supabase
      .channel(`marketing-barcode-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_marketing", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["project-marketing-barcode", projectId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["marketing-back-assets", projectId] }),
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
        .upsert({
          project_id: projectId,
          barcode_value: code,
          barcode_url: pub.publicUrl,
        } as never, { onConflict: "project_id" });
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

  const bakeBarcodeIntoImage = async (baseUrl: string, barcodeUrl: string) => {
    const [base, code] = await Promise.all([fetchAsImage(baseUrl), fetchAsImage(barcodeUrl)]);
    const canvas = document.createElement("canvas");
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    const targetW = Math.round(canvas.width * 0.22);
    const targetH = Math.round((targetW / code.naturalWidth) * code.naturalHeight);
    const pad = Math.round(canvas.width * 0.025);
    const x = canvas.width - targetW - pad;
    const y = canvas.height - targetH - pad;
    const cardPad = Math.round(targetW * 0.06);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - cardPad, y - cardPad, targetW + cardPad * 2, targetH + cardPad * 2);
    ctx.drawImage(code, x, y, targetW, targetH);
    const composedBlob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.92),
    );
    const finalPath = `${projectId}/marketing/back-final-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: upErr } = await supabase.storage.from("media").upload(finalPath, composedBlob, {
      upsert: true,
      contentType: "image/jpeg",
    });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("media").getPublicUrl(finalPath);
    return pub.publicUrl;
  };

  const handleGenerateBack = async () => {
    if (!data?.barcode_url || !data?.back_body) {
      toast.error("Generate the barcode + write back-cover copy first.");
      return;
    }
    setGeneratingBack(true);
    try {
      const composedPrompt = `Design a printable BACK-OF-BOX cover for a premium boxed murder-mystery game.

HEADLINE (place prominently at top): "${data.back_headline ?? ""}"

BODY COPY (place as a single readable paragraph in the central area, reserve enough negative space for it; do NOT render this text in the image — it will be typeset over the artwork later):
"""
${data.back_body}
"""

${data.tagline ? `TAGLINE (small, near top or bottom): "${data.tagline}"` : ""}

LAYOUT REQUIREMENTS:
- Vertical, 3:4 print-ready canvas, atmospheric, evocative.
- Genre-appropriate imagery; do NOT spoil the solution.
- Reserve a clean, untextured rectangular area in the LOWER-RIGHT corner (~22% x 18%) for a barcode that will be added in post — leave that area visually quiet.
- Reserve clean negative space across the central body region for paragraph copy.
- No text rendered into the artwork itself — typography will be added later.`;

      const modelOverride = getStoredImageModel("marketing-back", "chatgpt-image-2");
      const quality = getStoredImageQuality("marketing-back", "medium");
      let firstUrl: string | null = null;
      let lastOrigin: typeof backOrigin = null;
      for (let i = 0; i < generateCount; i += 1) {
        const resp = await callEdge("generate-image", {
          projectId,
          category: "marketing-back",
          prompt: `${composedPrompt}\n\nVariation ${i + 1}: use a distinct composition, color balance, and focal image while preserving the reserved copy and barcode areas.`,
          title: `Back of box option ${i + 1}`,
          modelOverride,
          quality,
          aspect: "portrait",
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          toast.error(json.error ?? "Back-cover generation failed", { duration: 10000 });
          return;
        }
        const baseUrl: string | undefined = json.url;
        if (!baseUrl) {
          toast.error("No image returned");
          return;
        }
        lastOrigin = {
          requested: (json.requestedModel as string) ?? null,
          effective: (json.effectiveModel as string) ?? null,
          fallback: (json.fallback as string) ?? "none",
        };

        let finalUrl = baseUrl;
        try {
          finalUrl = await bakeBarcodeIntoImage(baseUrl, data.barcode_url);
        } catch (e) {
          toast.error("Generated, but barcode overlay failed: " + (e instanceof Error ? e.message : "unknown"));
        }
        if (json.asset?.id) {
          await supabase.from("media_assets").update({ url: finalUrl, title: `Back of box option ${i + 1}` }).eq("id", json.asset.id);
        }
        firstUrl ??= finalUrl;
      }
      if (firstUrl) {
        setBackOrigin(lastOrigin);
        await supabase.from("project_marketing").upsert({
          project_id: projectId,
          back_cover_url: firstUrl,
        } as never, { onConflict: "project_id" });
        toast.success(`${generateCount} back-cover option${generateCount === 1 ? "" : "s"} ready`);
      }
    } finally {
      setGeneratingBack(false);
    }
  };

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
        <h3 className="font-display text-xl">Barcode & back of box</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Generate the EAN-13 first, then the back cover — the barcode is baked into the lower-right corner automatically.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
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

        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImageIcon className="h-4 w-4" /> Back cover
          </div>
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
          <ImageModelPicker surface="marketing-back" defaultModel="chatgpt-image-2" />
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-surface/70 p-2">
            <span className="text-xs font-medium text-muted-foreground">Generate options</span>
            <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
              {([1, 2, 4] as const).map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setGenerateCount(count)}
                  className={`h-7 min-w-8 rounded px-2 text-xs font-medium transition ${generateCount === count ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <Button
            onClick={handleGenerateBack}
            disabled={generatingBack || !barcodeReady || !copyReady}
            size="sm"
            className="w-full gap-1.5"
          >
            {generatingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {data?.back_cover_url ? "Generate more back-cover options" : "Generate back-cover options"}
          </Button>
        </div>
      </div>

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

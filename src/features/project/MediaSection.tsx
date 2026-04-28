// Stripped-down "prompt-and-go" generator for the Generation tab.
// One prompt, one model picker, one Generate button. Recent results render below.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Wand2, Loader2, Trash2, ExternalLink } from "lucide-react";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { DownloadButton } from "@/components/DownloadButton";
import { fireBackgroundImage } from "./fireBackgroundImage";
import { toast } from "sonner";

interface MediaAsset {
  id: string;
  project_id: string;
  category: string;
  title: string | null;
  url: string | null;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  effective_model: string | null;
  fallback: string | null;
  mime_type: string | null;
  created_at: string;
}

export function MediaSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<MediaAsset | null>(null);

  const { data } = useQuery({
    queryKey: ["media", projectId, "generation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .eq("project_id", projectId)
        .eq("category", "generation")
        .order("created_at", { ascending: false })
        .limit(48);
      if (error) throw error;
      return data as MediaAsset[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`media-gen-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ["media", projectId, "generation"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return toast.error("Type a prompt first");
    setGenerating(true);
    try {
      const modelOverride = getStoredImageModel("media", "chatgpt-image-2");
      const quality = getStoredImageQuality("media", "high");
      const result = await fireBackgroundImage({
        projectId,
        target: "media",
        category: "generation",
        prompt,
        modelOverride,
        quality,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not start generation", { duration: 10000 });
        return;
      }
      toast.success("Generating in background — feel free to leave this page");
      setPrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    if (!confirm("Delete this asset?")) return;
    await supabase.from("media_assets").delete().eq("id", asset.id);
  };

  const items = data ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div>
        <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-1">Generation</div>
        <h2 className="font-display text-3xl">Prompt &amp; go</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Type a prompt, pick a model, generate. Cover art, back of box, marketing visuals — all live in their own tabs.
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-soft space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Prompt</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="Describe the image you want…"
            className="resize-y"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!generating && prompt.trim()) void handleGenerate();
              }
            }}
          />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-64">
            <ImageModelPicker surface="media" defaultModel="chatgpt-image-2" />
          </div>
          <Button className="gap-2" onClick={handleGenerate} disabled={generating || !prompt.trim()}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Generate
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Tip: ⌘/Ctrl + Enter to generate.</p>
      </div>

      {items.length === 0 ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center text-muted-foreground">
          No generations yet. Type a prompt above and click Generate.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((a) => (
            <AssetCard key={a.id} asset={a} onOpen={() => setSelected(a)} onDelete={() => handleDelete(a)} />
          ))}
        </div>
      )}

      <AssetDialog asset={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AssetCard({ asset, onOpen, onDelete }: { asset: MediaAsset; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="group rounded-2xl border bg-card overflow-hidden shadow-soft hover:shadow-elegant transition-shadow relative">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="aspect-[4/3] bg-muted relative overflow-hidden">
          {asset.url && asset.mime_type?.startsWith("image") ? (
            <img src={asset.url} alt={asset.title ?? ""} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs uppercase tracking-widest">
              {asset.url ? "File" : "Pending…"}
            </div>
          )}
          {(asset.model || asset.effective_model) && asset.mime_type?.startsWith("image") && (
            <AiOriginBadge
              info={{
                requested: asset.model,
                effective: asset.effective_model ?? asset.model,
                fallback: asset.fallback,
                provider: asset.provider,
              }}
            />
          )}
        </div>
        <div className="p-3">
          <div className="text-xs text-muted-foreground line-clamp-2 leading-snug">
            {asset.prompt ?? "Untitled"}
          </div>
          <div className="text-[10px] text-muted-foreground/80 mt-1">
            {new Date(asset.created_at).toLocaleString()}
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between px-3 pb-3 gap-2">
        {asset.url && (
          <DownloadButton url={asset.url} filename={`generation-${asset.id}`} />
        )}
        {asset.url && (
          <a href={asset.url} target="_blank" rel="noreferrer" className="text-xs text-accent inline-flex items-center gap-1 hover:underline">
            <ExternalLink className="h-3 w-3" /> Open
          </a>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive ml-auto" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AssetDialog({ asset, onClose }: { asset: MediaAsset | null; onClose: () => void }) {
  if (!asset) return null;
  const isImage = asset.mime_type?.startsWith("image");
  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Generation</DialogTitle>
        </DialogHeader>
        {asset.url && isImage && <img src={asset.url} alt="" className="w-full rounded-lg" />}
        {asset.prompt && (
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Prompt</Label>
            <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap rounded-md border bg-muted/40 p-3">
              {asset.prompt}
            </div>
          </div>
        )}
        {(asset.model || asset.effective_model) && (
          <div className="text-[11px] text-muted-foreground">
            Generated with{" "}
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{asset.effective_model ?? asset.model}</code>
            {asset.provider && <> · {asset.provider}</>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {asset.url && <DownloadButton url={asset.url} filename={`generation-${asset.id}`} />}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

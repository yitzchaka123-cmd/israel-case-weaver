import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Upload, Wand2, Loader2, Trash2, Image as ImageIcon, Video, Film, Newspaper, Package, ExternalLink, FileText, RefreshCw, History as HistoryIcon } from "lucide-react";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { ImagePromptAssistant } from "@/components/ImagePromptAssistant";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { toast } from "sonner";

type OutputType = "image" | "document" | "both";

const OUTPUT_TYPES: { value: OutputType; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "document", label: "Document/file" },
  { value: "both", label: "Both" },
];

interface PromptHistoryEntry {
  at: string;
  prompt: string;
  effective_model?: string;
  requested_model?: string;
  fallback?: string;
  provider?: string;
}

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
  prompt_history: PromptHistoryEntry[] | null;
  mime_type: string | null;
  created_at: string;
}

const CATEGORIES = [
  { key: "cover", label: "Cover", icon: Package },
  { key: "back", label: "Back of box", icon: ImageIcon },
  { key: "news", label: "News report", icon: Newspaper },
  { key: "promo", label: "Promo video", icon: Film },
  { key: "external", label: "External uploads", icon: Video },
];

async function callEdge(name: string, body: unknown, timeoutMs = 120_000) {
  const { data: { session } } = await supabase.auth.getSession();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }
}

export function MediaSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [active, setActive] = useState("cover");

  const { data } = useQuery({
    queryKey: ["media", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as MediaAsset[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`media-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["media", projectId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  const byCategory = (cat: string) => (data ?? []).filter((a) => a.category === cat);

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div>
        <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-1">Generation</div>
        <h2 className="font-display text-3xl">Create media assets</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Generate cover art, back-of-box visuals, news reports, promo videos, and upload external files.
        </p>
      </div>

      <Tabs value={active} onValueChange={setActive}>
        <TabsList className="bg-surface/60 p-1 rounded-xl">
          {CATEGORIES.map((c) => (
            <TabsTrigger key={c.key} value={c.key} className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm gap-2">
              <c.icon className="h-3.5 w-3.5" /> {c.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORIES.map((c) => (
          <TabsContent key={c.key} value={c.key} className="mt-5">
            <CategoryPanel projectId={projectId} category={c.key} items={byCategory(c.key)} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CategoryPanel({ projectId, category, items }: { projectId: string; category: string; items: MediaAsset[] }) {
  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState("");
  const [title, setTitle] = useState("");
  const [outputType, setOutputType] = useState<OutputType>(category === "external" ? "document" : "image");
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const isImage = category === "cover" || category === "back" || category === "news";
  const isVideo = category === "promo";

  const handleUpload = async (file: File) => {
    const path = `${projectId}/${category}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("media").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("media").getPublicUrl(path);
    const { error: e2 } = await supabase.from("media_assets").insert({
      project_id: projectId,
      category,
      title: title || file.name,
      url: data.publicUrl,
      mime_type: file.type,
      provider: "upload",
    });
    if (e2) return toast.error(e2.message);
    toast.success("Uploaded");
    setTitle("");
  };

  const saveDocumentAttempt = async () => {
    const { error } = await supabase.from("media_assets").insert({
      project_id: projectId,
      category,
      title: title || "Document/file prompt",
      prompt,
      provider: "direct-model-file",
      asset_type: "document",
      document_format: "pdf",
      generation_mode: "direct_model_file",
      status: "failed",
      error_message: "Create a document row to generate a real file directly with the selected document model.",
    } as never);
    if (error) throw error;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return toast.error("Add a prompt first (or click Generate Prompt)");
    setGenerating(true);
    try {
      if (outputType === "image" || outputType === "both") {
        const modelOverride = getStoredImageModel("media", "chatgpt-image-2");
        const quality = getStoredImageQuality("media", "medium");
        const resp = await callEdge("generate-image", { projectId, category, prompt, title, modelOverride, quality });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({ error: "Failed" }));
          if (resp.status === 429) toast.error("Rate limit — try again in a moment.", { duration: 10000 });
          else if (resp.status === 402) toast.error(e.error ?? "Out of AI credits.", { duration: 15000 });
          else if (resp.status === 504) toast.error(e.error ?? "Image generation timed out — try Medium or Low quality.", { duration: 10000 });
          else toast.error(e.error ?? "Generation failed", { duration: 10000 });
          if (outputType === "image") return;
        }
      }
      if (outputType === "document" || outputType === "both") await saveDocumentAttempt();
      toast.success(outputType === "both" ? "Image generated; document prompt saved" : outputType === "document" ? "Document prompt saved" : "Image generated");
      setPrompt("");
      setHint("");
      setTitle("");
    } catch (e) {
      const msg = e instanceof Error
        ? (e.name === "AbortError" ? "Image generation timed out (>2 min). Try Medium/Low quality or a Gemini model." : e.message)
        : "Generation failed";
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    if (!confirm("Delete this asset?")) return;
    await supabase.from("media_assets").delete().eq("id", asset.id);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card p-5 shadow-soft space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Steering hint <span className="normal-case text-muted-foreground/70">(optional, fed to “Generate Prompt”)</span>
            </Label>
            <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. focus on the rainy alley at dusk" />
          </div>
        </div>

        {isImage && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> Image prompt — preview & edit before generating
              </Label>
              <div className="flex items-center gap-1.5">
                <PromptWriterModelPicker surface="media" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleSuggestPrompt}
                  disabled={suggestingPrompt}
                >
                  {suggestingPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {prompt.trim() ? "Regenerate prompt" : "Generate prompt"}
                </Button>
              </div>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Click Generate Prompt for a contextual draft based on your case, or write your own."
              rows={5}
              className="font-mono text-xs leading-relaxed"
            />
          </div>
        )}

        {isImage && (
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Output type</Label>
            <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
              {OUTPUT_TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOutputType(option.value)}
                  className={`h-8 rounded px-3 text-xs font-medium transition ${outputType === option.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isImage && (
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Video / news prompt</Label>
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the shot…" />
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <input
            ref={fileInput}
            type="file"
            accept={isVideo ? "video/*" : isImage ? "image/*" : "*/*"}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
          />
          <Button variant="outline" className="gap-2" onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" /> Upload {isVideo ? "video" : "file"}
          </Button>
          {isImage && (
            <>
              <div className="w-56">
                <ImageModelPicker surface="media" defaultModel="chatgpt-image-2" />
              </div>
              <Button className="gap-2" onClick={handleGenerate} disabled={generating || !prompt.trim()}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Generate {outputType === "both" ? "both" : outputType}
              </Button>
            </>
          )}
          {!isImage && prompt.trim() && (
            <Button
              variant="secondary"
              className="gap-2"
              onClick={async () => {
                await supabase.from("media_assets").insert({
                  project_id: projectId,
                  category,
                  title: title || "Prompt",
                  prompt,
                  provider: "prompt-only",
                });
                setPrompt("");
                setTitle("");
                toast.success("Prompt saved");
              }}
            >
              Save prompt only
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center text-muted-foreground">
          No assets in this category yet.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((a) => (
            <AssetCard key={a.id} asset={a} onOpen={() => setSelected(a)} onDelete={() => handleDelete(a)} />
          ))}
        </div>
      )}

      <AssetDialog
        asset={selected}
        projectId={projectId}
        category={category}
        onClose={() => setSelected(null)}
      />
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
          ) : asset.url && asset.mime_type?.startsWith("video") ? (
            <video src={asset.url} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs uppercase tracking-widest">
              {asset.provider === "prompt-only" ? "Prompt only" : "File"}
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
          <div className="font-medium text-sm truncate">{asset.title ?? "Untitled"}</div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {asset.provider ?? "—"} · {new Date(asset.created_at).toLocaleDateString()}
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between px-3 pb-3 gap-2">
        {asset.prompt && (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onOpen}>
            <FileText className="h-3 w-3" /> Show prompt
          </Button>
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

function AssetDialog({
  asset,
  projectId,
  category,
  onClose,
}: {
  asset: MediaAsset | null;
  projectId: string;
  category: string;
  onClose: () => void;
}) {
  const [editPrompt, setEditPrompt] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setEditPrompt(asset?.prompt ?? "");
  }, [asset?.id, asset?.prompt]);

  // Debounced autosave of edited prompt back to media_assets so the user
  // never loses an in-progress edit if the dialog closes.
  useEffect(() => {
    if (!asset?.id) return;
    if (editPrompt === (asset.prompt ?? "")) return;
    const t = setTimeout(() => {
      supabase.from("media_assets").update({ prompt: editPrompt }).eq("id", asset.id).then(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [editPrompt, asset?.id, asset?.prompt]);

  if (!asset) return null;

  const isImageAsset = asset.mime_type?.startsWith("image");

  const handleRegeneratePrompt = async () => {
    setRegenPrompt(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const writerModel = getStoredWriterModel("media");
      const resp = await callEdge("suggest-image-prompt", {
        projectId,
        category: asset.category ?? category,
        currentPrompt: editPrompt.trim() || undefined,
        writerModel: writerModel === "__project" ? undefined : writerModel,
        userId: session?.user?.id,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Couldn't generate a prompt");
        return;
      }
      setEditPrompt(json.prompt);
      toast.success("Prompt revised");
    } finally {
      setRegenPrompt(false);
    }
  };

  const handleRetry = async () => {
    if (!editPrompt.trim()) return toast.error("Prompt is empty");
    setRetrying(true);
    try {
      const modelOverride = getStoredImageModel("media", "chatgpt-image-2");
      const quality = getStoredImageQuality("media", "medium");
      const resp = await callEdge("generate-image", {
        projectId,
        category: asset.category ?? category,
        prompt: editPrompt,
        title: asset.title ?? undefined,
        modelOverride,
        quality,
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: "Failed" }));
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.", { duration: 10000 });
        else if (resp.status === 402) toast.error(e.error ?? "Out of AI credits.", { duration: 15000 });
        else if (resp.status === 504) toast.error(e.error ?? "Image generation timed out — try Medium or Low quality.", { duration: 10000 });
        else toast.error(e.error ?? "Generation failed", { duration: 10000 });
        return;
      }
      toast.success("New image generated");
      onClose();
    } catch (e) {
      const msg = e instanceof Error
        ? (e.name === "AbortError" ? "Image generation timed out (>2 min). Try Medium/Low quality or a Gemini model." : e.message)
        : "Generation failed";
      toast.error(msg);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{asset.title ?? "Asset"}</DialogTitle>
        </DialogHeader>
        {asset.url && isImageAsset && (
          <img src={asset.url} alt="" className="w-full rounded-lg" />
        )}
        {asset.url && asset.mime_type?.startsWith("video") && (
          <video src={asset.url} controls className="w-full rounded-lg" />
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> Prompt — edit and retry
            </Label>
            {isImageAsset && (
              <div className="flex items-center gap-1.5">
                <PromptWriterModelPicker surface="media" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleRegeneratePrompt}
                  disabled={regenPrompt}
                >
                  {regenPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Revise prompt with AI
                </Button>
              </div>
            )}
          </div>
          <Textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={8}
            className="font-mono text-xs leading-relaxed"
            placeholder={asset.prompt ? undefined : "No prompt was saved with this asset. You can write one and retry."}
          />
          {(asset.model || asset.effective_model) && (
            <div className="text-[11px] text-muted-foreground space-y-1 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span>Generated with</span>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{asset.effective_model ?? asset.model}</code>
                {asset.fallback && asset.fallback !== "none" && (
                  <span className="text-amber-600 dark:text-amber-400">
                    (fell back from <code className="text-[10px]">{asset.model}</code> via {asset.fallback})
                  </span>
                )}
                {asset.provider && <span>· {asset.provider}</span>}
              </div>
              {asset.prompt_history && asset.prompt_history.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowHistory((s) => !s)}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <History className="h-3 w-3" />
                    {showHistory ? "Hide" : "Show"} previous prompts ({asset.prompt_history.length})
                  </button>
                  {showHistory && (
                    <ul className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-2">
                      {asset.prompt_history.map((h, i) => (
                        <li key={i} className="border-l-2 border-muted pl-2">
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(h.at).toLocaleString()} · {h.effective_model ?? h.requested_model ?? "—"}
                            {h.fallback && h.fallback !== "none" && ` · ${h.fallback}`}
                          </div>
                          <div className="font-mono text-[10px] whitespace-pre-wrap">{h.prompt}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {isImageAsset && (
            <Button onClick={handleRetry} disabled={retrying || !editPrompt.trim()} className="gap-2">
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Retry image with this prompt
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

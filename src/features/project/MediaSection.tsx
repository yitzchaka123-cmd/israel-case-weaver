import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Wand2, Loader2, Trash2, Image as ImageIcon, Video, Film, Newspaper, Package, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { ImageModelPicker, getStoredImageModel } from "@/components/ImageModelPicker";

interface MediaAsset {
  id: string;
  project_id: string;
  category: string;
  title: string | null;
  url: string | null;
  prompt: string | null;
  provider: string | null;
  model: string | null;
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
        <h2 className="font-display text-3xl">Promotions & Media</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cover art, back-of-box, televised news report, promo videos, and any external uploads.
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
  const [title, setTitle] = useState("");
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

  const handleGenerateImage = async () => {
    if (!prompt.trim()) return toast.error("Add a prompt first");
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ projectId, category, prompt, title }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: "Failed" }));
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits.");
        else toast.error(e.error ?? "Generation failed");
        return;
      }
      toast.success("Image generated");
      setPrompt("");
      setTitle("");
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
              {isImage ? "Image prompt" : "Video/news prompt"}
            </Label>
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the shot…" />
          </div>
        </div>
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
            <Button className="gap-2" onClick={handleGenerateImage} disabled={generating || !prompt.trim()}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate with AI
            </Button>
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
            <div key={a.id} className="group rounded-2xl border bg-card overflow-hidden shadow-soft hover:shadow-elegant transition-shadow">
              <button onClick={() => setSelected(a)} className="block w-full text-left">
                <div className="aspect-[4/3] bg-muted relative overflow-hidden">
                  {a.url && a.mime_type?.startsWith("image") ? (
                    <img src={a.url} alt={a.title ?? ""} className="w-full h-full object-cover" />
                  ) : a.url && a.mime_type?.startsWith("video") ? (
                    <video src={a.url} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs uppercase tracking-widest">
                      {a.provider === "prompt-only" ? "Prompt only" : "File"}
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="font-medium text-sm truncate">{a.title ?? "Untitled"}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {a.provider ?? "—"} · {new Date(a.created_at).toLocaleDateString()}
                  </div>
                </div>
              </button>
              <div className="flex items-center justify-between px-3 pb-3 gap-2">
                {a.url && (
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-accent inline-flex items-center gap-1 hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open
                  </a>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive ml-auto" onClick={() => handleDelete(a)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{selected?.title ?? "Asset"}</DialogTitle>
          </DialogHeader>
          {selected?.url && selected.mime_type?.startsWith("image") && (
            <img src={selected.url} alt="" className="w-full rounded-lg" />
          )}
          {selected?.url && selected.mime_type?.startsWith("video") && (
            <video src={selected.url} controls className="w-full rounded-lg" />
          )}
          {selected?.prompt && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Prompt</Label>
              <Textarea readOnly rows={6} value={selected.prompt} className="font-mono text-xs" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

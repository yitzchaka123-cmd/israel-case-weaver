// Panel A — shows the project cover prominently and lets the user generate
// additional marketing images (back of box, marketing-extra). Reuses
// PromptPanel + suggest-image-prompt + generate-image like the Media tab.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PromptPanel } from "@/components/PromptPanel";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { Plus, Trash2, Image as ImageIcon, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

const MARKETING_CATEGORIES = ["cover", "back", "marketing-extra"];

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

export function CoverAndVisuals({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newHint, setNewHint] = useState("");
  const [generating, setGenerating] = useState(false);

  const { data: project } = useQuery({
    queryKey: ["project-cover-only", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("title, cover_image_url, cover_effective_model, cover_fallback, ai_provider_images").eq("id", projectId).maybeSingle();
      return data;
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

  useEffect(() => {
    const ch = supabase
      .channel(`marketing-assets-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["marketing-assets", projectId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["project-cover-only", projectId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  const cover = project?.cover_image_url;
  const extras = (assets ?? []).filter((a) => a.category === "marketing-extra" || a.category === "back");

  const handleGenerate = async (prompt: string) => {
    setGenerating(true);
    try {
      const modelOverride = getStoredImageModel("marketing-cover", "chatgpt-image-2");
      const quality = getStoredImageQuality("marketing-cover", "medium");
      const resp = await callEdge("generate-image", {
        projectId,
        category: "marketing-extra",
        prompt,
        title: newTitle || "Marketing image",
        modelOverride,
        quality,
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        toast.error(e.error ?? "Image generation failed", { duration: 10000 });
        return;
      }
      toast.success("Marketing image generated");
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
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2 text-center px-6">
                <ImageIcon className="h-8 w-8" />
                <p className="text-sm">No cover yet — generate one in <strong>Overview</strong>.</p>
              </div>
            )}
          </div>
          <div className="px-4 py-3 text-xs text-muted-foreground border-t">
            <span className="font-medium text-foreground">Front cover</span> · pulled live from the project
          </div>
        </div>

        <div className="space-y-3">
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
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-2">
                    <span className="text-[10px] text-white truncate flex-1">{a.title ?? a.category}</span>
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
          <PromptPanel
            projectId={projectId}
            surface="media"
            category="marketing-extra"
            hint={newHint}
            onGenerate={handleGenerate}
            generating={generating}
            mode="inline"
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

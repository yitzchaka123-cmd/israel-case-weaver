// In-game scenes panel — 4 textareas + auto-suggest + a single "Generate
// scenes" call that returns 4 style-shared images in one gpt-image-2 batch.
// Stored in media_assets with category='in-game-scene'. Wired into the
// front+back cover generator as additional reference images.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Wand2, Image as ImageIcon, Download } from "lucide-react";
import { toast } from "sonner";
import { downloadAsset, slugify } from "@/lib/utils";

interface SceneRow {
  id: string;
  url: string | null;
  title: string | null;
  prompt: string | null;
  created_at: string;
}

interface SceneInput { label: string; prompt: string }

const DEFAULTS: SceneInput[] = [
  { label: "Scene 1", prompt: "" },
  { label: "Scene 2", prompt: "" },
  { label: "Scene 3", prompt: "" },
  { label: "Scene 4", prompt: "" },
];

export function InGameScenesPanel({ projectId, brandReferenceUrl, brandLabel }: {
  projectId: string;
  brandReferenceUrl: string | null;
  brandLabel: string | null;
}) {
  const qc = useQueryClient();
  const [scenes, setScenes] = useState<SceneInput[]>(DEFAULTS);
  const [generating, setGenerating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const { data: sceneAssets } = useQuery({
    queryKey: ["in-game-scenes", projectId],
    queryFn: async (): Promise<SceneRow[]> => {
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, url, title, prompt, created_at")
        .eq("project_id", projectId)
        .eq("category", "in-game-scene")
        .order("created_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return (data ?? []) as SceneRow[];
    },
  });

  // Hydrate textareas from latest saved scenes (on first load only).
  useEffect(() => {
    if (!sceneAssets || sceneAssets.length === 0) return;
    setScenes((prev) => {
      // Only hydrate if textareas are still all-empty defaults.
      const empty = prev.every((s) => !s.prompt.trim());
      if (!empty) return prev;
      const ordered = [...sceneAssets].reverse(); // oldest first
      const next = [...DEFAULTS];
      ordered.forEach((row, i) => {
        if (i < 4) next[i] = { label: row.title ?? `Scene ${i + 1}`, prompt: row.prompt ?? "" };
      });
      return next;
    });
  }, [sceneAssets]);

  useEffect(() => {
    const ch = supabase
      .channel(`in-game-scenes-${projectId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "media_assets",
        filter: `project_id=eq.${projectId}`,
      }, () => qc.invalidateQueries({ queryKey: ["in-game-scenes", projectId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  const updateScene = (i: number, patch: Partial<SceneInput>) => {
    setScenes((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };

  const handleAutoSuggest = async () => {
    setSuggesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-scene-prompts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ projectId }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error ?? "Could not suggest"); return; }
      const next = (j.scenes as SceneInput[]).slice(0, 4);
      while (next.length < 4) next.push({ label: `Scene ${next.length + 1}`, prompt: "" });
      setScenes(next.map((s, i) => ({
        label: s.label || `Scene ${i + 1}`,
        prompt: s.prompt || "",
      })));
      toast.success("Suggested 4 scenes — review and edit before generating");
    } finally {
      setSuggesting(false);
    }
  };

  const handleGenerate = async () => {
    if (scenes.some((s) => !s.prompt.trim())) {
      toast.error("Fill in all 4 scene prompts first.");
      return;
    }
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-in-game-scenes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          projectId,
          scenes,
          referenceImageUrl: brandReferenceUrl,
          referenceLabel: brandLabel,
          quality: "high",
        }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error ?? `Could not start (${r.status})`); return; }
      toast.success("Generating 4 in-game scenes — ~60-90s. They'll appear below and feed the back-cover generator.");
    } finally {
      setGenerating(false);
    }
  };

  const sceneList = sceneAssets ?? [];

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ImageIcon className="h-4 w-4" /> In-game scenes (4)
        </div>
        <Button
          size="sm" variant="outline" className="gap-1.5 h-8"
          onClick={handleAutoSuggest} disabled={suggesting}
        >
          {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Auto-suggest
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        These 4 scenes are generated together (one batch call) so they share style, then attached as references when generating the back cover.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        {scenes.map((s, i) => (
          <div key={i} className="rounded-lg border bg-background p-2 space-y-2">
            <Input
              value={s.label}
              onChange={(e) => updateScene(i, { label: e.target.value })}
              placeholder={`Scene ${i + 1} label`}
              className="text-xs h-8"
            />
            <Textarea
              value={s.prompt}
              onChange={(e) => updateScene(i, { prompt: e.target.value })}
              placeholder={`Describe scene ${i + 1}…`}
              className="text-xs min-h-[80px]"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleGenerate} disabled={generating} size="sm" className="gap-1.5">
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Generate 4 scenes
        </Button>
      </div>

      {sceneList.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          {sceneList.map((row, i) => (
            <div key={row.id} className="group relative aspect-square bg-muted rounded-md overflow-hidden border">
              {row.url ? (
                <>
                  <img src={row.url} alt={row.title ?? `Scene ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-1.5 py-1 truncate">
                    {row.title ?? `Scene ${i + 1}`}
                  </div>
                  <Button
                    size="sm" variant="secondary"
                    className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => downloadAsset(row.url!, slugify(row.title ?? `scene-${i + 1}`))}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">…generating</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

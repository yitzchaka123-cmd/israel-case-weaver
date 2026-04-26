import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AutoSaveTextarea } from "@/components/AutoSave";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Lightbulb, Plus, Trash2, ImageIcon, ChevronDown, Loader2, Pin, Upload } from "lucide-react";
import { toast } from "sonner";
import { ImagePromptAssistant } from "@/components/ImagePromptAssistant";
import { ImageHistoryStrip, type ImageHistoryRow } from "@/components/ImageHistoryStrip";
import { FinalAssetPicker } from "@/components/FinalAssetPicker";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { useBackgroundImageJob } from "@/features/project/useBackgroundImageJob";
import { GenerationTimer } from "@/features/project/GenerationTimer";

interface Hint {
  id: string;
  project_id: string;
  stage: number;
  level: number;
  text: string | null;
}

interface HintSheet {
  id: string;
  project_id: string;
  stage: number;
  image_url: string | null;
  uploaded_image_url: string | null;
  active_version: string;
  prompt: string | null;
  effective_model: string | null;
  fallback: string | null;
  prompt_history: { at: string; prompt: string; effective_model?: string; fallback?: string }[] | null;
}

const LEVELS = [
  { n: 1, label: "Vague nudge", tone: "muted" },
  { n: 2, label: "More helpful", tone: "accent" },
  { n: 3, label: "Reveals the task", tone: "warning" },
];

export function HintsSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["hints", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hints")
        .select("*")
        .eq("project_id", projectId)
        .order("stage")
        .order("level");
      if (error) throw error;
      return data as Hint[];
    },
  });

  const { data: sheets } = useQuery({
    queryKey: ["hint_sheets", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hint_sheets")
        .select("*")
        .eq("project_id", projectId)
        .order("stage");
      if (error) throw error;
      return (data ?? []) as HintSheet[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`hints-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hints", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["hints", projectId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "hint_sheets", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["hint_sheets", projectId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  const sheetByStage = useMemo(() => {
    const m = new Map<number, HintSheet>();
    (sheets ?? []).forEach((s) => m.set(s.stage, s));
    return m;
  }, [sheets]);

  const stages = useMemo(() => {
    const map = new Map<number, Record<number, Hint | undefined>>();
    (data ?? []).forEach((h) => {
      if (!map.has(h.stage)) map.set(h.stage, {});
      map.get(h.stage)![h.level] = h;
    });
    const maxStage = Math.max(0, ...Array.from(map.keys()));
    return Array.from({ length: Math.max(1, maxStage) }, (_, i) => ({
      stage: i + 1,
      byLevel: map.get(i + 1) ?? {},
    }));
  }, [data]);

  const addStage = async () => {
    const nextStage = stages.length + 1;
    await supabase.from("hints").insert(
      LEVELS.map((l) => ({ project_id: projectId, stage: nextStage, level: l.n, text: "" })),
    );
  };

  const upsertHint = async (stage: number, level: number, text: string, existing?: Hint) => {
    if (existing) {
      await supabase.from("hints").update({ text }).eq("id", existing.id);
    } else {
      await supabase.from("hints").insert({ project_id: projectId, stage, level, text });
    }
  };

  const deleteStage = async (stage: number) => {
    if (!confirm(`Delete stage ${stage} hints?`)) return;
    await supabase.from("hints").delete().eq("project_id", projectId).eq("stage", stage);
    await supabase.from("hint_sheets").delete().eq("project_id", projectId).eq("stage", stage);
  };

  const placeOnCanvas = async (stage: number) => {
    // Add a hint node to the FINAL board (the detective wall) at a sensible offset
    const { data: existing } = await supabase
      .from("canvas_nodes")
      .select("id")
      .eq("project_id", projectId)
      .eq("board", "final")
      .eq("node_type", "hint")
      .ilike("title", `Stage ${stage} hints`)
      .maybeSingle();
    if (existing) {
      toast.info(`Stage ${stage} hint node already on final board`);
      return;
    }
    const { error } = await supabase.from("canvas_nodes").insert({
      project_id: projectId,
      board: "final",
      node_type: "hint",
      title: `Stage ${stage} hints`,
      description: "Hint ladder for this stage (vague → helpful → reveal).",
      position_x: -200,
      position_y: stage * 160,
    } as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Placed Stage ${stage} on the final board`);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl">Hint system</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Three hints per stage — vague, helpful, then reveal. Linked to the printed hint card QR flow.
          </p>
        </div>
        <Button onClick={addStage} className="gap-2">
          <Plus className="h-4 w-4" /> Add stage
        </Button>
      </div>

      {stages.length === 0 || !data?.length ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center">
          <Lightbulb className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No hint stages yet. Add your first stage to begin.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stages.map(({ stage, byLevel }) => (
            <div key={stage} className="rounded-2xl border bg-card shadow-soft overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b bg-surface/40">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-accent/10 text-accent-foreground flex items-center justify-center text-sm font-semibold">
                    {stage}
                  </div>
                  <div className="font-display text-lg">Stage {stage}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-1.5" onClick={() => placeOnCanvas(stage)}>
                    <Pin className="h-3.5 w-3.5" /> Place on canvas
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive gap-1.5" onClick={() => deleteStage(stage)}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>
              <div className="grid md:grid-cols-3 gap-4 p-5">
                {LEVELS.map((l) => {
                  const existing = byLevel[l.n];
                  return (
                    <div key={l.n} className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                        {l.n}. {l.label}
                      </Label>
                      <AutoSaveTextarea
                        rows={4}
                        dir="rtl"
                        className="text-right"
                        value={existing?.text ?? ""}
                        onSave={(v) => upsertHint(stage, l.n, v, existing)}
                        placeholder="כתוב את הרמז בעברית…"
                      />
                    </div>
                  );
                })}
              </div>

              <HintSheetBlock
                projectId={projectId}
                stage={stage}
                sheet={sheetByStage.get(stage) ?? null}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HintSheetBlock({ projectId, stage, sheet }: { projectId: string; stage: number; sheet: HintSheet | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<string>(sheet?.prompt ?? "");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sheetJob = useBackgroundImageJob({
    projectId,
    target: "hint-sheet",
    targetId: String(stage),
    onDone: () => {
      toast.success(`Stage ${stage} hint sheet generated`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["hint_sheets", projectId] });
      refetchHistory();
    },
    onError: (msg) => toast.error(msg, { duration: 15000 }),
  });

  useEffect(() => { setDraftPrompt(sheet?.prompt ?? ""); }, [sheet?.id, sheet?.prompt]);

  // Persist prompt edits onto the hint_sheets row (debounced).
  useEffect(() => {
    if (!sheet?.id) return;
    if (draftPrompt === (sheet.prompt ?? "")) return;
    const t = setTimeout(() => {
      supabase.from("hint_sheets").update({ prompt: draftPrompt }).eq("id", sheet.id).then(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [draftPrompt, sheet?.id, sheet?.prompt]);

  // Per-stage history strip (filtered by source_hint_sheet_id).
  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ["hint-image-history", sheet?.id],
    queryFn: async () => {
      if (!sheet?.id) return [];
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, url, preview_url, model, effective_model, provider, fallback, created_at")
        .eq("source_hint_sheet_id", sheet.id)
        .not("url", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as ImageHistoryRow[];
    },
    enabled: !!sheet?.id,
  });

  const generate = async () => {
    const prompt = draftPrompt.trim();
    if (!prompt) {
      toast.error("Click Create prompt first, or type a prompt in the Final prompt tab");
      return;
    }
    const model = getStoredImageModel("hint", "chatgpt-image");
    const quality = getStoredImageQuality("hint", "medium");
    try {
      await sheetJob.start({
        prompt,
        modelOverride: model,
        quality,
        aspect: "portrait",
        category: "hint-sheet",
      });
      toast.message("Generating in the background — you can close the tab.");
    } catch {
      // start() already showed an error toast
    }
  };

  const uploadSheet = async (file: File) => {
    if (!sheet?.id) {
      toast.error("Generate the sheet first, or it will be created on first generation");
      return;
    }
    const path = `${projectId}/hint-sheet-${stage}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("media").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("media").getPublicUrl(path);
    await supabase.from("hint_sheets").update({ uploaded_image_url: data.publicUrl, active_version: "uploaded" }).eq("id", sheet.id);
    qc.invalidateQueries({ queryKey: ["hint_sheets", projectId] });
    toast.success("Upload set as the active hint sheet");
  };

  const restoreFromHistory = async (item: ImageHistoryRow) => {
    if (!sheet?.id || !item.url) return;
    await supabase.from("hint_sheets").update({
      image_url: item.url,
      effective_model: item.effective_model ?? item.model,
      fallback: item.fallback ?? null,
      active_version: "generated",
    }).eq("id", sheet.id);
    qc.invalidateQueries({ queryKey: ["hint_sheets", projectId] });
    toast.success("Hint sheet restored as active");
  };

  const setActiveVersion = async (v: string) => {
    if (!sheet?.id) return;
    await supabase.from("hint_sheets").update({ active_version: v }).eq("id", sheet.id);
    qc.invalidateQueries({ queryKey: ["hint_sheets", projectId] });
  };

  const activeUrl = sheet?.active_version === "uploaded"
    ? (sheet?.uploaded_image_url ?? sheet?.image_url ?? null)
    : (sheet?.image_url ?? sheet?.uploaded_image_url ?? null);

  

  return (
    <div className="border-t bg-muted/20 px-5 py-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <span>Printable hint sheet</span>
          {activeUrl && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">— ready</span>
          )}
        </div>
        <Button
          size="sm"
          variant={activeUrl ? "outline" : "default"}
          className="gap-1.5"
          onClick={() => setOpen((o) => !o)}
        >
          {activeUrl ? "Regenerate hint sheet" : "Create hint sheet"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </div>

      {activeUrl && (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="relative inline-block group rounded-lg overflow-hidden border bg-background"
        >
          <img
            src={activeUrl}
            alt={`Stage ${stage} hint sheet`}
            className="max-h-72 object-contain"
          />
          <AiOriginBadge
            info={{ effective: sheet?.effective_model, fallback: sheet?.fallback }}
            position="absolute"
            hoverOnly
          />
        </button>
      )}

      {open && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Image model
            </Label>
            <ImageModelPicker surface="hint" defaultModel="chatgpt-image" className="w-[260px]" />
          </div>
          <ImagePromptAssistant
            projectId={projectId}
            surface="hint"
            category="hint-sheet"
            targetId={sheet?.id ?? `stage-${stage}`}
            hint={`Stage ${stage} of the hint ladder.`}
            prompt={draftPrompt}
            onChange={setDraftPrompt}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={generate} disabled={generating || !draftPrompt.trim()} className="gap-2">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              Generate hint sheet
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadSheet(e.target.files[0])} />
            <Button size="sm" variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Upload sheet
            </Button>
          </div>
          {generating && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating stage {stage} hint sheet…
            </div>
          )}
        </div>
      )}

      {sheet && (
        <>
          <ImageHistoryStrip
            items={history ?? []}
            currentUrl={sheet.image_url}
            onRestore={restoreFromHistory}
            title={`Stage ${stage} history`}
          />
          {(sheet.image_url || sheet.uploaded_image_url) && (
            <FinalAssetPicker
              value={sheet.active_version}
              onChange={setActiveVersion}
              generatedUrl={sheet.image_url}
              uploadedUrl={sheet.uploaded_image_url}
              generatedLabel="Generated sheet"
              uploadedLabel="Uploaded sheet"
            />
          )}
        </>
      )}

      {activeUrl && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl p-4">
            <div className="relative rounded-lg bg-muted overflow-hidden border">
              <img src={activeUrl} alt={`Stage ${stage} hint sheet preview`} className="max-h-[80vh] w-full object-contain" />
              <AiOriginBadge info={{ effective: sheet?.effective_model, fallback: sheet?.fallback }} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

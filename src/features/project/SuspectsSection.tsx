import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AutoSaveInput, AutoSaveTextarea } from "@/components/AutoSave";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Upload, Trash2, UserCircle2, Loader2 } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { ImagePromptAssistant } from "@/components/ImagePromptAssistant";
import { ImageHistoryStrip, type ImageHistoryRow } from "@/components/ImageHistoryStrip";
import { FinalAssetPicker } from "@/components/FinalAssetPicker";
import { AssistantOriginBadge } from "@/components/AssistantOriginBadge";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { useBackgroundImageJob } from "@/features/project/useBackgroundImageJob";
import { GenerationTimer } from "@/features/project/GenerationTimer";
import { syncSuspectThumbnailToIntakeDocs } from "@/features/project/syncSuspectIntake";

interface Suspect {
  id: string;
  project_id: string;
  name: string;
  thumbnail_url: string | null;
  alt_thumbnail_url: string | null;
  uploaded_thumbnail_url: string | null;
  active_version: string;
  summary: string | null;
  role_in_case: string | null;
  motives: string | null;
  secrets: string | null;
  contradictions: string | null;
  is_red_herring: boolean;
  position: number;
  created_by_message_id: string | null;
  thumbnail_prompt?: string | null;
  thumbnail_effective_model?: string | null;
  thumbnail_fallback?: string | null;
}

export function SuspectsSection({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, refetch } = useQuery({
    queryKey: ["suspects", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suspects")
        .select("*")
        .eq("project_id", projectId)
        .order("position");
      if (error) throw error;
      return data as Suspect[];
    },
  });

  const addSuspect = async () => {
    const nextPos = (data?.length ?? 0);
    const { error } = await supabase.from("suspects").insert({ project_id: projectId, position: nextPos });
    if (error) toast.error(error.message);
    else refetch();
  };

  const selectedSuspect = data?.find((s) => s.id === selected) ?? null;

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-3xl">Suspects</h2>
        <Button onClick={addSuspect} className="gap-2">
          <Plus className="h-4 w-4" /> Add suspect
        </Button>
      </div>
      {!data?.length ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center">
          <UserCircle2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No suspects yet. Add your first one to build the cast.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {data.map((s) => (
            <div key={s.id} className="relative group">
              <button
                onClick={() => setSelected(s.id)}
                className="w-full text-left bg-card border rounded-2xl overflow-hidden shadow-soft hover:shadow-pop hover:-translate-y-0.5 transition-all"
              >
                <div className="aspect-[3/4] bg-muted relative">
                  {s.thumbnail_url ? (
                    <img src={s.thumbnail_url} alt={s.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <UserCircle2 className="h-10 w-10 text-muted-foreground/40" />
                    </div>
                  )}
                  {s.thumbnail_url && (
                    <AiOriginBadge
                      info={{ requested: s.thumbnail_url ? "nano-banana" : null, effective: s.thumbnail_effective_model ?? null, fallback: s.thumbnail_fallback ?? null }}
                      hoverOnly
                    />
                  )}
                  {s.is_red_herring && (
                    <span className="absolute top-2 left-2 text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md bg-destructive text-destructive-foreground">
                      Red herring
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="font-medium truncate flex-1">{s.name}</div>
                    <AssistantOriginBadge messageId={s.created_by_message_id} label="" />
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {s.role_in_case || "—"}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm(`Delete suspect "${s.name || "Untitled"}"? This cannot be undone.`)) return;
                  const { error } = await supabase.from("suspects").delete().eq("id", s.id);
                  if (error) toast.error(error.message);
                  else { toast.success("Suspect deleted"); refetch(); }
                }}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-background/90 backdrop-blur border shadow-sm text-muted-foreground hover:text-destructive hover:border-destructive/40"
                aria-label="Delete suspect"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <SuspectDialog
        key={selectedSuspect?.id}
        suspect={selectedSuspect}
        onClose={() => { setSelected(null); refetch(); }}
      />
    </div>
  );
}

function SuspectDialog({ suspect, onClose }: { suspect: Suspect | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Suspect | null>(suspect);
  const [portraitPrompt, setPortraitPrompt] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => setDraft(suspect), [suspect?.id]);

  // Load the most recent portrait prompt for this suspect (so we can show
  // and edit what produced the current image).
  useEffect(() => {
    if (!suspect?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("prompts")
        .select("original_prompt, final_prompt")
        .eq("project_id", suspect.project_id)
        .eq("scope", "suspect-thumbnail")
        .eq("target_id", suspect.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setPortraitPrompt(data?.original_prompt ?? data?.final_prompt ?? "");
    })();
    return () => { cancelled = true; };
  }, [suspect?.id, suspect?.project_id, draft?.thumbnail_url]);

  // Per-suspect generation history strip.
  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ["suspect-image-history", suspect?.id],
    queryFn: async () => {
      if (!suspect) return [];
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, url, preview_url, model, effective_model, provider, fallback, created_at")
        .eq("source_suspect_id", suspect.id)
        .not("url", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as ImageHistoryRow[];
    },
    enabled: !!suspect?.id,
  });

  if (!suspect || !draft) return null;

  const update = (patch: Partial<Suspect>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await supabase.from("suspects").update({
        name: next.name, summary: next.summary, role_in_case: next.role_in_case,
        motives: next.motives, secrets: next.secrets, contradictions: next.contradictions,
        is_red_herring: next.is_red_herring,
        thumbnail_prompt: next.thumbnail_prompt,
        active_version: next.active_version,
        uploaded_thumbnail_url: next.uploaded_thumbnail_url,
      }).eq("id", next.id);
    }, 500);
  };

  const uploadThumb = async (file: File) => {
    const path = `${suspect.project_id}/${suspect.id}-uploaded-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("suspects").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("suspects").getPublicUrl(path);
    await supabase.from("suspects").update({ uploaded_thumbnail_url: data.publicUrl, active_version: "uploaded" }).eq("id", suspect.id);
    setDraft({ ...draft, uploaded_thumbnail_url: data.publicUrl, active_version: "uploaded" });
    void syncSuspectThumbnailToIntakeDocs({ projectId: suspect.project_id, suspectId: suspect.id, portraitUrl: data.publicUrl });
    toast.success("Upload set as the active portrait");
  };

  const restoreFromHistory = async (item: ImageHistoryRow) => {
    if (!item.url) return;
    await supabase.from("suspects").update({
      thumbnail_url: item.url,
      thumbnail_effective_model: item.effective_model ?? item.model,
      thumbnail_fallback: item.fallback ?? null,
      active_version: "generated",
    }).eq("id", suspect.id);
    setDraft((d) => d ? { ...d, thumbnail_url: item.url!, active_version: "generated", thumbnail_effective_model: item.effective_model ?? item.model, thumbnail_fallback: item.fallback ?? null } : d);
    void syncSuspectThumbnailToIntakeDocs({ projectId: suspect.project_id, suspectId: suspect.id, portraitUrl: item.url });
    toast.success("Portrait restored as active");
  };

  // Background-safe portrait generation. The edge function inserts a pending
  // image_generations row, then keeps running on Supabase via
  // EdgeRuntime.waitUntil — closing the tab no longer cancels the work. The
  // hook subscribes via realtime and shows a live mm:ss timer that survives
  // refresh and reopen.
  const portraitJob = useBackgroundImageJob({
    projectId: suspect?.project_id ?? "",
    target: "suspect-thumbnail",
    targetId: suspect?.id,
    onDone: (url) => {
      setDraft((d) => d ? { ...d, thumbnail_url: url, active_version: "generated" } : d);
      setPortraitPrompt(draft?.thumbnail_prompt ?? "");
      refetchHistory();
      if (suspect?.project_id && suspect?.id) {
        void syncSuspectThumbnailToIntakeDocs({ projectId: suspect.project_id, suspectId: suspect.id, portraitUrl: url });
      }
      toast.success("Portrait ready");
    },
    onError: (msg) => toast.error(msg, { duration: 15000 }),
  });

  const generatePortrait = async (): Promise<void> => {
    const prompt = (draft?.thumbnail_prompt ?? "").trim();
    if (!prompt) {
      toast.error("Click Create prompt first, or paste a prompt into the Final prompt tab");
      return;
    }
    const modelOverride = getStoredImageModel("suspect", "nano-banana-2");
    const quality = getStoredImageQuality("suspect", "medium");
    try {
      await portraitJob.start({ prompt, modelOverride, aspect: "portrait", quality });
      toast.message("Generating in the background — you can close the tab.");
    } catch {
      // start() already showed a toast via onError
    }
  };

  const remove = async () => {
    if (!confirm("Delete this suspect?")) return;
    await supabase.from("suspects").delete().eq("id", suspect.id);
    onClose();
  };

  const activeUrl = draft.active_version === "uploaded" ? (draft.uploaded_thumbnail_url ?? draft.thumbnail_url) : (draft.thumbnail_url ?? draft.uploaded_thumbnail_url);

  return (
    <Dialog open={!!suspect} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            Suspect file
            <AssistantOriginBadge messageId={draft.created_by_message_id} />
          </DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-[170px_1fr] gap-6">
          <div>
            <button type="button" onClick={() => activeUrl && setPreviewOpen(true)} className="block w-full aspect-[3/4] rounded-xl overflow-hidden border bg-muted relative group">
              {activeUrl ? (
                <>
                  <img src={activeUrl} alt={draft.name} className="w-full h-full object-cover" />
                  <AiOriginBadge
                    info={{ requested: null, effective: draft.thumbnail_effective_model ?? null, fallback: draft.thumbnail_fallback ?? null }}
                    hoverOnly
                  />
                </>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <UserCircle2 className="h-10 w-10 text-muted-foreground/40" />
                </div>
              )}
              {portraitJob.isPending && (
                <GenerationTimer elapsedSec={portraitJob.state.elapsedSec} label="Generating portrait" />
              )}
            </button>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadThumb(e.target.files[0])} />
            <div className="mt-2 space-y-2">
              <ImageModelPicker surface="suspect" defaultModel="nano-banana-2" className="w-full" />
              <ImagePromptAssistant
                projectId={suspect.project_id}
                surface="suspect"
                category="external"
                targetId={suspect.id}
                hint={[draft.name && `Name: ${draft.name}`, draft.role_in_case && `Role: ${draft.role_in_case}`, draft.summary && `About: ${draft.summary}`].filter(Boolean).join(". ")}
                prompt={draft.thumbnail_prompt ?? portraitPrompt ?? ""}
                onChange={(next) => update({ thumbnail_prompt: next })}
              />
              <Button size="sm" variant="outline" className="w-full gap-2" onClick={generatePortrait} disabled={portraitJob.isPending}>
                {portraitJob.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCircle2 className="h-3.5 w-3.5" />}
                Generate portrait
              </Button>
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => fileInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload
              </Button>
              <ImageHistoryStrip
                items={history ?? []}
                currentUrl={draft.thumbnail_url}
                onRestore={restoreFromHistory}
                title="Portrait history"
              />
              <FinalAssetPicker
                value={draft.active_version}
                onChange={(v) => update({ active_version: v })}
                generatedUrl={draft.thumbnail_url}
                uploadedUrl={draft.uploaded_thumbnail_url}
                generatedLabel="Generated portrait"
                uploadedLabel="Uploaded photo"
              />
            </div>
          </div>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
              <AutoSaveInput value={draft.name} onSave={(v) => update({ name: v })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Role in case</Label>
              <AutoSaveInput value={draft.role_in_case ?? ""} onSave={(v) => update({ role_in_case: v })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Summary</Label>
              <AutoSaveTextarea rows={3} value={draft.summary ?? ""} onSave={(v) => update({ summary: v })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Motives</Label>
              <AutoSaveTextarea rows={2} value={draft.motives ?? ""} onSave={(v) => update({ motives: v })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Secrets</Label>
              <AutoSaveTextarea rows={2} value={draft.secrets ?? ""} onSave={(v) => update({ secrets: v })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Contradictions</Label>
              <AutoSaveTextarea rows={2} value={draft.contradictions ?? ""} onSave={(v) => update({ contradictions: v })} />
            </div>
            <div className="flex items-center justify-between pt-2">
              <Label className="flex items-center gap-2">
                <Switch checked={draft.is_red_herring} onCheckedChange={(v) => update({ is_red_herring: v })} />
                Red herring
              </Label>
              <Button variant="ghost" size="sm" className="text-destructive gap-2" onClick={remove}>
                <Trash2 className="h-3.5 w-3.5" /> Delete suspect
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
      {activeUrl && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl p-4">
            <div className="relative rounded-lg bg-muted overflow-hidden border">
              <img src={activeUrl} alt="Portrait preview" className="max-h-[80vh] w-full object-contain" />
              <AiOriginBadge info={{ requested: null, effective: draft.thumbnail_effective_model ?? null, fallback: draft.thumbnail_fallback ?? null }} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

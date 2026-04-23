// Panel E — Storyboard Studio. Three-column workflow:
//   1. Script  — length picker + script instructions + generate-storyboard(mode:"script")
//   2. Prompts — engine instructions (Sora/Kling) + per-shot generate-storyboard(mode:"prompt")
//   3. Visuals — generate keyframe per shot via generate-image
//
// State persists in project_storyboards (latest row per project).
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, ArrowRight, Wand2, Image as ImageIcon, Save, FileText, Copy, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { useProjectNotifications } from "@/features/project/notifications/useProjectNotifications";

type Engine = "sora" | "kling";
type Length = 30 | 60 | 90 | 120;

interface Shot {
  id: string;
  n: number;
  duration_s: number;
  action: string;
  voiceover: string;
  on_screen_text: string;
  engine: Engine;
  prompt: string;
  image_url: string | null;
  in_prompts: boolean; // visible in column 2
  in_storyboard: boolean; // visible in column 3
  image_requested_model?: string | null;
  image_effective_model?: string | null;
  image_fallback?: string | null;
}

interface StoryboardRow {
  id: string;
  project_id: string;
  length_seconds: number;
  script_instructions: string | null;
  sora_instructions: string | null;
  kling_instructions: string | null;
  shots: Shot[];
  status: string;
}

const LENGTHS: Length[] = [30, 60, 90, 120];

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

const uid = () => Math.random().toString(36).slice(2, 10);

export function StoryboardStudio({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { create: createNotif } = useProjectNotifications(projectId);

  const [length, setLength] = useState<Length>(60);
  const [scriptInstr, setScriptInstr] = useState("");
  const [soraInstr, setSoraInstr] = useState("");
  const [klingInstr, setKlingInstr] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [rowId, setRowId] = useState<string | null>(null);

  const [generatingScript, setGeneratingScript] = useState(false);
  const [busyShot, setBusyShot] = useState<Record<string, "prompt" | "image" | undefined>>({});
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["project-storyboards", projectId],
    queryFn: async (): Promise<StoryboardRow | null> => {
      const { data, error } = await supabase
        .from("project_storyboards")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as StoryboardRow) ?? null;
    },
  });

  useEffect(() => {
    if (!data) return;
    setRowId(data.id);
    setLength((LENGTHS.includes(data.length_seconds as Length) ? data.length_seconds : 60) as Length);
    setScriptInstr(data.script_instructions ?? "");
    setSoraInstr(data.sora_instructions ?? "");
    setKlingInstr(data.kling_instructions ?? "");
    setShots(Array.isArray(data.shots) ? (data.shots as Shot[]).map((s) => ({
      id: s.id ?? uid(),
      n: s.n,
      duration_s: s.duration_s,
      action: s.action ?? "",
      voiceover: s.voiceover ?? "",
      on_screen_text: s.on_screen_text ?? "",
      engine: (s.engine === "kling" ? "kling" : "sora") as Engine,
      prompt: s.prompt ?? "",
      image_url: s.image_url ?? null,
      in_prompts: s.in_prompts ?? !!s.prompt,
      in_storyboard: s.in_storyboard ?? !!s.image_url,
      image_requested_model: s.image_requested_model ?? null,
      image_effective_model: s.image_effective_model ?? null,
      image_fallback: s.image_fallback ?? null,
    })) : []);
  }, [data]);

  const promptShots = useMemo(() => shots.filter((s) => s.in_prompts), [shots]);
  const boardShots = useMemo(() => shots.filter((s) => s.in_storyboard), [shots]);

  const updateShot = (id: string, patch: Partial<Shot>) => {
    setShots((s) => s.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)));
  };

  const persist = async (next?: Partial<StoryboardRow>) => {
    setSaving(true);
    const payload = {
      project_id: projectId,
      length_seconds: length,
      script_instructions: scriptInstr,
      sora_instructions: soraInstr,
      kling_instructions: klingInstr,
      shots: shots as never,
      status: "draft",
      ...(next ?? {}),
      ...(rowId ? { id: rowId } : {}),
    };
    let res;
    if (rowId) {
      res = await supabase.from("project_storyboards").update(payload as never).eq("id", rowId).select("id").maybeSingle();
    } else {
      res = await supabase.from("project_storyboards").insert(payload as never).select("id").single();
    }
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message);
      return null;
    }
    if (res.data && (res.data as { id?: string }).id) setRowId((res.data as { id: string }).id);
    qc.invalidateQueries({ queryKey: ["project-storyboards", projectId] });
    return res.data;
  };

  const handleGenerateScript = async () => {
    setGeneratingScript(true);
    try {
      const resp = await callEdge("generate-storyboard", {
        projectId,
        mode: "script",
        length_seconds: length,
        script_instructions: scriptInstr || undefined,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Script generation failed", { duration: 10000 });
        return;
      }
      const newShots: Shot[] = (json.shots as Array<Partial<Shot>>).map((s, i) => ({
        id: uid(),
        n: s.n ?? i + 1,
        duration_s: s.duration_s ?? 0,
        action: s.action ?? "",
        voiceover: s.voiceover ?? "",
        on_screen_text: s.on_screen_text ?? "",
        engine: "sora",
        prompt: "",
        image_url: null,
        in_prompts: false,
        in_storyboard: false,
      }));
      setShots(newShots);
      toast.success(`Drafted ${newShots.length} shots`);
      createNotif({
        kind: "storyboard_script_ready",
        title: "Script's drafted — review it before I write the visual prompts.",
        body: `${newShots.length} shots, ~${length}s. Edit any shot, then push to the Prompts column.`,
        starter_prompt: "Walk me through the storyboard script and suggest tweaks.",
        created_by: "assistant",
      });
    } finally {
      setGeneratingScript(false);
    }
  };

  const pushToPrompts = (id: string) => updateShot(id, { in_prompts: true });
  const pushAllToPrompts = () => setShots((s) => s.map((sh) => ({ ...sh, in_prompts: true })));
  const pushToBoard = (id: string) => updateShot(id, { in_storyboard: true });

  const handleGeneratePrompt = async (shot: Shot) => {
    setBusyShot((b) => ({ ...b, [shot.id]: "prompt" }));
    try {
      const resp = await callEdge("generate-storyboard", {
        projectId,
        mode: "prompt",
        engine: shot.engine,
        engine_instructions: (shot.engine === "kling" ? klingInstr : soraInstr) || undefined,
        shot: {
          n: shot.n,
          duration_s: shot.duration_s,
          action: shot.action,
          voiceover: shot.voiceover,
          on_screen_text: shot.on_screen_text,
        },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Prompt generation failed", { duration: 10000 });
        return;
      }
      updateShot(shot.id, { prompt: json.prompt as string });
      toast.success(`Shot ${shot.n} prompt drafted`);
    } finally {
      setBusyShot((b) => ({ ...b, [shot.id]: undefined }));
    }
  };

  const handleGenerateKeyframe = async (shot: Shot) => {
    if (!shot.prompt.trim()) {
      toast.error("Generate a visual prompt first.");
      return;
    }
    setBusyShot((b) => ({ ...b, [shot.id]: "image" }));
    try {
      const modelOverride = getStoredImageModel("storyboard", "nano-banana-2");
      const quality = getStoredImageQuality("storyboard", "medium");
      const resp = await callEdge("generate-image", {
        projectId,
        category: "marketing-storyboard",
        prompt: `Cinematic single still keyframe (16:9) for trailer shot #${shot.n}.\n\n${shot.prompt}`,
        title: `Shot ${shot.n}`,
        modelOverride,
        quality,
        aspect: "landscape",
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Keyframe generation failed", { duration: 10000 });
        return;
      }
      updateShot(shot.id, { image_url: json.url as string, in_storyboard: true });
      toast.success(`Shot ${shot.n} keyframe ready`);
    } finally {
      setBusyShot((b) => ({ ...b, [shot.id]: undefined }));
    }
  };

  const handleGenerateAllKeyframes = async () => {
    for (const shot of boardShots) {
      if (shot.image_url || !shot.prompt) continue;
      // eslint-disable-next-line no-await-in-loop
      await handleGenerateKeyframe(shot);
    }
  };

  const handleCopyAllPrompts = async () => {
    const text = boardShots
      .map((s) => `# Shot ${s.n} (${s.duration_s}s) — ${s.engine.toUpperCase()}\n${s.prompt}`)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    toast.success("All prompts copied to clipboard");
  };

  const handleNewVersion = async () => {
    if (!confirm("Start a new storyboard version? The current one will be kept in history.")) return;
    setRowId(null);
    setShots([]);
    setScriptInstr("");
    toast.success("Started a new version — generate a script to begin.");
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-xl">Storyboard studio</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Script → engine prompts (Sora 2 / Kling 3) → visual storyboard. Save the prompts now, render the videos later.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleNewVersion} className="text-xs">New version</Button>
          <Button onClick={() => persist()} size="sm" variant="outline" className="gap-1.5" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Column 1 — Script */}
        <ColumnFrame title="1 · Script" accent="from-indigo-500/15 to-transparent">
          <div className="space-y-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Length</Label>
              <div className="flex gap-1.5 mt-1.5">
                {LENGTHS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLength(l)}
                    className={[
                      "flex-1 px-2 py-1.5 text-xs font-medium rounded-md border transition-colors",
                      length === l ? "bg-accent text-accent-foreground border-accent" : "bg-surface border-border text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {l}s
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Script instructions</Label>
              <Textarea
                rows={3}
                value={scriptInstr}
                onChange={(e) => setScriptInstr(e.target.value)}
                placeholder="e.g. open on a close-up of the locket; end on the title card"
                className="text-xs mt-1.5"
              />
            </div>
            <Button onClick={handleGenerateScript} disabled={generatingScript} size="sm" className="w-full gap-1.5">
              {generatingScript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {shots.length ? "Re-generate script" : "Generate script"}
            </Button>
            {shots.length > 0 && (
              <Button onClick={pushAllToPrompts} variant="outline" size="sm" className="w-full gap-1.5 text-xs">
                Push all shots to prompts <ChevronRight className="h-3 w-3" />
              </Button>
            )}
          </div>

          <div className="space-y-2 mt-4 max-h-[600px] overflow-y-auto pr-1">
            {shots.map((shot) => (
              <ShotScriptCard
                key={shot.id}
                shot={shot}
                onChange={(patch) => updateShot(shot.id, patch)}
                onPush={() => pushToPrompts(shot.id)}
                onDelete={() => setShots((s) => s.filter((x) => x.id !== shot.id))}
              />
            ))}
            {shots.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-8 border border-dashed rounded-lg">
                No shots yet. Generate a script to get started.
              </div>
            )}
          </div>
        </ColumnFrame>

        {/* Column 2 — Prompts */}
        <ColumnFrame title="2 · Visual prompts" accent="from-purple-500/15 to-transparent">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <EngineInstrInput label="Sora 2 instructions" value={soraInstr} onChange={setSoraInstr} engine="sora" />
              <EngineInstrInput label="Kling 3 instructions" value={klingInstr} onChange={setKlingInstr} engine="kling" />
            </div>
          </div>

          <div className="space-y-2 mt-4 max-h-[600px] overflow-y-auto pr-1">
            {promptShots.map((shot) => (
              <ShotPromptCard
                key={shot.id}
                shot={shot}
                busy={busyShot[shot.id] === "prompt"}
                onChange={(patch) => updateShot(shot.id, patch)}
                onGenerate={() => handleGeneratePrompt(shot)}
                onPush={() => pushToBoard(shot.id)}
              />
            ))}
            {promptShots.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-8 border border-dashed rounded-lg">
                Push shots from the script column to start drafting prompts.
              </div>
            )}
          </div>
        </ColumnFrame>

        {/* Column 3 — Storyboard */}
        <ColumnFrame title="3 · Visual storyboard" accent="from-teal-500/15 to-transparent">
          <div className="space-y-2">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Keyframe image model</Label>
              <div className="mt-1.5">
                <ImageModelPicker surface="storyboard" defaultModel="nano-banana-2" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleGenerateAllKeyframes} size="sm" variant="outline" className="flex-1 gap-1.5 text-xs" disabled={boardShots.length === 0}>
                <Wand2 className="h-3 w-3" /> Generate all keyframes
              </Button>
              <Button onClick={handleCopyAllPrompts} size="sm" variant="ghost" className="gap-1.5 text-xs" disabled={boardShots.length === 0}>
                <Copy className="h-3 w-3" /> Copy prompts
              </Button>
            </div>
          </div>

          <div className="space-y-3 mt-4 max-h-[600px] overflow-y-auto pr-1">
            {boardShots.map((shot) => (
              <ShotBoardCard
                key={shot.id}
                shot={shot}
                busy={busyShot[shot.id] === "image"}
                onGenerate={() => handleGenerateKeyframe(shot)}
              />
            ))}
            {boardShots.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-8 border border-dashed rounded-lg">
                Push shots with prompts here, then generate keyframes.
              </div>
            )}
          </div>
        </ColumnFrame>
      </div>
    </section>
  );
}

function ColumnFrame({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border bg-gradient-to-b ${accent} bg-surface/40 p-4 space-y-3`}>
      <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function EngineInstrInput({ label, value, onChange, engine }: { label: string; value: string; onChange: (v: string) => void; engine: Engine }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${engine === "sora" ? "bg-purple-500" : "bg-teal-500"}`} />
        {label}
      </Label>
      <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. anamorphic 35mm, low-key noir lighting, slow push-ins" className="text-xs mt-1.5" />
    </div>
  );
}

function ShotScriptCard({ shot, onChange, onPush, onDelete }: { shot: Shot; onChange: (p: Partial<Shot>) => void; onPush: () => void; onDelete: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2 group">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground">#{shot.n}</span> · {shot.duration_s}s
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onDelete}>
            <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </Button>
          <Button size="sm" variant={shot.in_prompts ? "ghost" : "outline"} className="h-6 px-2 gap-1 text-[10px]" onClick={onPush}>
            {shot.in_prompts ? "In prompts" : "Push"} <ArrowRight className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>
      <Textarea rows={2} value={shot.action} onChange={(e) => onChange({ action: e.target.value })} placeholder="Action…" className="text-xs" />
      <div className="grid grid-cols-2 gap-1.5">
        <Input value={shot.voiceover} onChange={(e) => onChange({ voiceover: e.target.value })} placeholder="VO" className="text-[11px] h-7" />
        <Input value={shot.on_screen_text} onChange={(e) => onChange({ on_screen_text: e.target.value })} placeholder="On-screen text" className="text-[11px] h-7" />
      </div>
    </div>
  );
}

function ShotPromptCard({ shot, busy, onChange, onGenerate, onPush }: { shot: Shot; busy: boolean; onChange: (p: Partial<Shot>) => void; onGenerate: () => void; onPush: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <span className="font-mono text-foreground">#{shot.n}</span>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${shot.engine === "sora" ? "bg-purple-500" : "bg-teal-500"}`} />
          <Select value={shot.engine} onValueChange={(v) => onChange({ engine: v as Engine })}>
            <SelectTrigger className="h-6 w-[88px] text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sora" className="text-xs">Sora 2</SelectItem>
              <SelectItem value="kling" className="text-xs">Kling 3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant={shot.in_storyboard ? "ghost" : "outline"} className="h-6 px-2 gap-1 text-[10px]" onClick={onPush} disabled={!shot.prompt.trim()}>
          {shot.in_storyboard ? "On board" : "To board"} <ArrowRight className="h-2.5 w-2.5" />
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground italic line-clamp-2">{shot.action}</div>
      <Textarea
        rows={3}
        value={shot.prompt}
        onChange={(e) => onChange({ prompt: e.target.value })}
        placeholder="Click Generate to draft the engine prompt"
        className="text-[11px] font-mono leading-relaxed"
      />
      <Button size="sm" variant="ghost" className="w-full gap-1.5 text-[11px] h-7" onClick={onGenerate} disabled={busy}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        {shot.prompt.trim() ? "Regenerate prompt" : "Generate prompt"}
      </Button>
    </div>
  );
}

function ShotBoardCard({ shot, busy, onGenerate }: { shot: Shot; busy: boolean; onGenerate: () => void }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="aspect-video bg-muted relative">
        {shot.image_url ? (
          <img src={shot.image_url} alt={`Shot ${shot.n}`} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono">#{shot.n} · {shot.duration_s}s</div>
        <div className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${shot.engine === "sora" ? "bg-purple-500/90 text-white" : "bg-teal-500/90 text-white"}`}>
          {shot.engine.toUpperCase()}
        </div>
      </div>
      <div className="p-2 space-y-1.5">
        <div className="text-[10px] text-muted-foreground line-clamp-3 font-mono leading-relaxed">{shot.prompt || "—"}</div>
        <Button size="sm" variant="ghost" className="w-full gap-1.5 text-[11px] h-7" onClick={onGenerate} disabled={busy || !shot.prompt}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : shot.image_url ? <FileText className="h-3 w-3" /> : <Wand2 className="h-3 w-3" />}
          {shot.image_url ? "Regenerate keyframe" : "Generate keyframe"}
        </Button>
      </div>
    </div>
  );
}

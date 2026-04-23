import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { PromptPanel } from "@/components/PromptPanel";
import { AssistantOriginBadge } from "@/components/AssistantOriginBadge";
import { ProductionDashboard } from "./ProductionDashboard";
import { normalizePhase } from "./PhaseStatusBar";
import { useProjectNotifications } from "./notifications/useProjectNotifications";
import { notifyForFieldChange, type TriggerableField } from "./notifications/triggers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const MYSTERY_TYPES = [
  "Espionage / Intelligence",
  "Political Intrigue",
  "Based on Real Events",
  "Terror Plot",
  "Cybercrime",
  "Courtroom Drama",
  "Murder & Homicide",
];
const GENRES = ["Technological", "Mathematical", "Historical", "Forensics", "Psychological"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];

// Map Hebrew / common synonyms for difficulty back to canonical English
// so a value like "בינוני" still highlights "Medium" in the picker.
const DIFFICULTY_SYNONYMS: Record<string, string> = {
  easy: "Easy", medium: "Medium", hard: "Hard",
  "קל": "Easy", "בינוני": "Medium", "קשה": "Hard",
};
function normalizeDifficulty(v: string | null | undefined): string {
  if (!v) return "";
  const trimmed = String(v).trim();
  const lower = trimmed.toLowerCase();
  if (DIFFICULTY_SYNONYMS[lower]) return DIFFICULTY_SYNONYMS[lower];
  if (DIFFICULTY_SYNONYMS[trimmed]) return DIFFICULTY_SYNONYMS[trimmed];
  return trimmed;
}

const CUSTOM_SENTINEL = "__custom__";

/**
 * A Select that tolerates any value — including ones outside the curated list
 * (e.g. assistant-written values like "Police procedural / realistic"). If the
 * value isn't canonical, it's prepended as a "· custom" item so the trigger
 * displays it instead of falling back to the placeholder. A "Custom…" option
 * at the bottom flips the control into a free-text Input.
 */
function TolerantSelect({
  value,
  options,
  onChange,
  placeholder = "Choose…",
  normalize,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  normalize?: (v: string) => string;
}) {
  const displayValue = normalize ? normalize(value) : value;
  const [freeText, setFreeText] = useState(false);

  if (freeText) {
    return (
      <div className="space-y-1">
        <Input
          autoFocus
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a custom value…"
        />
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground underline"
          onClick={() => setFreeText(false)}
        >
          Back to presets
        </button>
      </div>
    );
  }

  const isCustom = displayValue && !options.includes(displayValue);

  return (
    <Select
      value={displayValue || ""}
      onValueChange={(v) => {
        if (v === CUSTOM_SENTINEL) {
          setFreeText(true);
          return;
        }
        onChange(v);
      }}
    >
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {isCustom ? (
          <SelectItem value={displayValue}>{displayValue} · custom</SelectItem>
        ) : null}
        {options.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
        <SelectItem value={CUSTOM_SENTINEL}>Custom…</SelectItem>
      </SelectContent>
    </Select>
  );
}


export function ProjectOverview({ project }: { project: any }) {
  const [draft, setDraft] = useState(project);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const { create: createNotification } = useProjectNotifications(project.id);

  // Local UI state for the "extra selling point" toggle. Default derived from
  // difficulty: Hard → on, otherwise off. Honors any pre-existing text.
  const initialSellingOn = !!project.selling_point || normalizeDifficulty(project.difficulty) === "Hard";
  const [sellingOn, setSellingOn] = useState<boolean>(initialSellingOn);

  useEffect(() => {
    setDraft(project);
    setSellingOn(!!project.selling_point || normalizeDifficulty(project.difficulty) === "Hard");
  }, [project.id]);

  // Fields that may emit a "the assistant should weigh in" notification.
  const TRIGGER_MAP: Partial<Record<keyof typeof draft, TriggerableField>> = {
    difficulty: "difficulty",
    mystery_type: "mystery_type",
    genre: "genre",
    player_role: "player_role",
    target_doc_count: "target_doc_count",
    case_goal: "case_goal",
  };

  // Debounced autosave
  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);

    // Fire notifications for any tracked field that just changed.
    for (const key of Object.keys(patch) as Array<keyof typeof draft>) {
      const trigger = TRIGGER_MAP[key];
      if (!trigger) continue;
      const draftNotif = notifyForFieldChange(trigger, draft[key], next[key], next);
      if (draftNotif) createNotification(draftNotif);
    }

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const { error } = await supabase
        .from("projects")
        .update({
          title: next.title,
          subtitle: next.subtitle,
          mystery_type: next.mystery_type,
          genre: next.genre,
          year: next.year,
          difficulty: next.difficulty,
          player_role: next.player_role,
          case_goal: next.case_goal,
          setting: next.setting,
          selling_point: next.selling_point,
          target_doc_count: next.target_doc_count,
          phase: next.phase,
          packaging_notes: next.packaging_notes,
        })
        .eq("id", next.id);
      if (error) toast.error(error.message);
    }, 600);
  };

  // Toggling the "Extra selling point" switch.
  const handleSellingToggle = (on: boolean) => {
    if (!on && draft.selling_point && String(draft.selling_point).trim().length > 0) {
      const ok = window.confirm(
        "Turning off the extra selling point will clear what you've written. Continue?",
      );
      if (!ok) return;
    }
    setSellingOn(on);
    if (on) {
      const draftNotif = notifyForFieldChange("selling_point_toggle_on", null, true, draft);
      if (draftNotif) createNotification(draftNotif);
    } else {
      // Clear the value when turning off.
      update({ selling_point: null });
    }
  };

  const uploadCover = async (file: File) => {
    const path = `${project.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("covers").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("covers").getPublicUrl(path);
    await supabase.from("projects").update({ cover_image_url: data.publicUrl }).eq("id", project.id);
    setDraft({ ...draft, cover_image_url: data.publicUrl });
    toast.success("Cover updated");
  };

  const [genCover, setGenCover] = useState(false);
  const [coverPrompt, setCoverPrompt] = useState<string>("");

  // Load the most recent cover prompt so users can see what produced the
  // current image (and edit it for a regen).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("prompts")
        .select("original_prompt, final_prompt")
        .eq("project_id", project.id)
        .eq("scope", "project-cover")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setCoverPrompt(data?.original_prompt ?? data?.final_prompt ?? "");
    })();
    return () => { cancelled = true; };
  }, [project.id, draft.cover_image_url]);

  const generateCover = async (promptOverride?: string): Promise<void> => {
    const promptToUse = promptOverride?.trim();
    if (!promptToUse) {
      toast.error("Write a prompt first");
      return;
    }
    setGenCover(true);
    const t = toast.loading("Generating cover…");
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 120_000);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const modelOverride = getStoredImageModel("cover", "chatgpt-image");
      const quality = getStoredImageQuality("cover", "medium");
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ projectId: project.id, prompt: promptToUse, target: "project-cover", modelOverride, aspect: "portrait", quality }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error ?? `Failed (${resp.status})`);
      setDraft({ ...draft, cover_image_url: json.url });
      setCoverPrompt(promptToUse);
      toast.success("Cover ready", { id: t });
    } catch (e) {
      const msg = e instanceof Error
        ? (e.name === "AbortError" ? "Image generation timed out (>2 min). Try Medium/Low quality or a Gemini model." : e.message)
        : "Failed";
      toast.error(msg, { id: t, duration: 15000 });
    } finally {
      window.clearTimeout(timer);
      setGenCover(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <Panel>
          <SectionTitle>Case Identity</SectionTitle>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Title" originId={draft.assistant_origins?.title}>
              <Input value={draft.title ?? ""} onChange={(e) => update({ title: e.target.value })} />
            </Field>
            <Field label="Subtitle" originId={draft.assistant_origins?.subtitle}>
              <Input
                value={draft.subtitle ?? ""}
                onChange={(e) => update({ subtitle: e.target.value })}
                placeholder="The assistant will fill this in during setup — or type your own."
              />
            </Field>
            <Field label="Mystery type" originId={draft.assistant_origins?.mystery_type}>
              <TolerantSelect
                value={draft.mystery_type ?? ""}
                options={MYSTERY_TYPES}
                onChange={(v) => update({ mystery_type: v })}
              />
            </Field>
            <Field label="Genre" originId={draft.assistant_origins?.genre}>
              <TolerantSelect
                value={draft.genre ?? ""}
                options={GENRES}
                onChange={(v) => update({ genre: v })}
              />
            </Field>
            <Field label="Difficulty" originId={draft.assistant_origins?.difficulty}>
              <TolerantSelect
                value={draft.difficulty ?? ""}
                options={DIFFICULTIES}
                onChange={(v) => update({ difficulty: v })}
                normalize={normalizeDifficulty}
              />
            </Field>
            <Field label="Year" originId={draft.assistant_origins?.year}>
              <Input
                type="number"
                value={draft.year ?? ""}
                onChange={(e) => update({ year: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Case brief</SectionTitle>
          <div className="space-y-4">
            <Field label="Player role" originId={draft.assistant_origins?.player_role}>
              <Input value={draft.player_role ?? ""} onChange={(e) => update({ player_role: e.target.value })} placeholder="e.g. Mossad junior analyst" />
            </Field>
            <Field label="Case goal" originId={draft.assistant_origins?.case_goal}>
              <Textarea value={draft.case_goal ?? ""} onChange={(e) => update({ case_goal: e.target.value })} rows={3} />
            </Field>
            <Field label="Setting / location" originId={draft.assistant_origins?.setting}>
              <Input
                value={draft.setting ?? ""}
                onChange={(e) => update({ setting: e.target.value })}
                placeholder="The assistant will fill this in during setup — or type your own."
              />
            </Field>
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                    Extra selling point
                    <AssistantOriginBadge messageId={draft.assistant_origins?.selling_point} label="" />
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    A standout hook that elevates the case. Defaults ON for Hard, OFF for Easy/Medium — toggle anytime.
                  </p>
                </div>
                <Switch checked={sellingOn} onCheckedChange={handleSellingToggle} />
              </div>
              {sellingOn && (
                <Textarea
                  value={draft.selling_point ?? ""}
                  onChange={(e) => update({ selling_point: e.target.value })}
                  rows={2}
                  placeholder="e.g. a 1980s telex machine that decodes the final clue. The assistant can help you plan this — check the bell."
                  className="bg-background"
                />
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Production</SectionTitle>
          <ProductionDashboard
            projectId={project.id}
            phase={draft.phase}
            targetDocCount={draft.target_doc_count ?? null}
            logicApprovedAt={draft.logic_approved_at ?? null}
            onJump={(tab) => window.dispatchEvent(new CustomEvent("mystudio:navigate", { detail: { tab } }))}
          />

          <div className="grid md:grid-cols-2 gap-4 mt-6">
            <Field label="Target document count">
              {draft.target_doc_count ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 rounded-md border bg-muted/40 text-sm flex items-center gap-2">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{draft.target_doc_count}</span>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">Unlock</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Override target document count?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure? Changing this can desync your production — document numbering and envelope flow rely on this number.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => update({ target_doc_count: null })}>
                          Yes, unlock
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : (
                <Input
                  type="number"
                  value={draft.target_doc_count ?? ""}
                  onChange={(e) => update({ target_doc_count: e.target.value ? Number(e.target.value) : null })}
                  placeholder="e.g. 40"
                />
              )}
              {draft.target_doc_count ? (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Locked. Changing this would derail document numbering and envelope flow.
                </p>
              ) : null}
            </Field>
            <Field label="Current phase">
              <div className="px-3 py-2 rounded-md border bg-muted/40 text-sm flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium capitalize">{normalizePhase(draft.phase)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Phase advances automatically as the assistant moves you through Setup → Summary → Structure → …
              </p>
            </Field>
          </div>

          <div className="mt-4">
            {(draft.phase === "packaging" || draft.phase === "done") ? (
              <Field label="Packaging notes" originId={draft.assistant_origins?.packaging_notes}>
                <Textarea value={draft.packaging_notes ?? ""} onChange={(e) => update({ packaging_notes: e.target.value })} rows={3} />
              </Field>
            ) : (
              <div className="px-4 py-3 rounded-lg border border-dashed bg-muted/20 text-xs text-muted-foreground">
                Packaging notes appear here when the assistant reaches the Packaging phase.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel>
          <SectionTitle>Cover</SectionTitle>
          <div className="aspect-[3/4] rounded-xl overflow-hidden border bg-gradient-soft relative">
            {draft.cover_image_url ? (
              <img src={draft.cover_image_url} alt="Cover" className="w-full h-full object-cover" />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <Upload className="h-8 w-8 opacity-30" />
              </div>
            )}
          </div>
          <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])} />
          <div className="mt-3 space-y-3">
            <ImageModelPicker surface="cover" defaultModel="chatgpt-image" className="w-full" />
            <PromptPanel
              projectId={project.id}
              surface="cover"
              category="cover"
              initialPrompt={coverPrompt}
              generating={genCover}
              onGenerate={(p) => generateCover(p)}
              mode={draft.cover_image_url ? "archive" : "inline"}
            />
            <Button variant="outline" className="w-full" onClick={() => fileInput.current?.click()}>
              {draft.cover_image_url ? "Replace cover" : "Upload cover"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            The cover becomes your dashboard thumbnail.
          </p>
        </Panel>

        <Panel>
          <SectionTitle>Autosave</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Every change is saved automatically. Last updated:{" "}
            {new Date(project.updated_at).toLocaleString()}
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="bg-card border rounded-2xl p-6 shadow-soft">{children}</div>;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-xl mb-4">{children}</h2>;
}
function Field({ label, children, originId }: { label: string; children: React.ReactNode; originId?: string | null }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
        {label}
        <AssistantOriginBadge messageId={originId} label="" />
      </Label>
      {children}
    </div>
  );
}

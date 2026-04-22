import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ImageModelPicker, getStoredImageModel } from "@/components/ImageModelPicker";

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
const PHASES = ["setup", "summary", "structure", "documents", "hints", "packaging", "done"];

export function ProjectOverview({ project }: { project: any }) {
  const [draft, setDraft] = useState(project);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => setDraft(project), [project.id]);

  // Debounced autosave
  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
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
  const generateCover = async () => {
    const desc = [
      draft.title && `Title: "${draft.title}"`,
      draft.subtitle && `Subtitle: "${draft.subtitle}"`,
      draft.mystery_type && `Type: ${draft.mystery_type}`,
      draft.genre && `Genre: ${draft.genre}`,
      draft.year && `Year: ${draft.year}`,
      draft.setting && `Setting: ${draft.setting}`,
      draft.case_goal && `Case: ${draft.case_goal}`,
    ].filter(Boolean).join(". ");
    if (!desc) return toast.error("Fill in title / type / setting first");
    setGenCover(true);
    const t = toast.loading("Generating cover…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const modelOverride = getStoredImageModel("cover", "chatgpt-image-2");
      const prompt = `Premium printable BOX-COVER artwork for an Israeli mystery / detective board game. Cinematic, evocative, painterly photo-real style. Strong central focal subject, dramatic lighting, period-accurate. Composition leaves space at the top for a future title treatment. 3:4 portrait. NO text, NO logos, NO watermarks — pure illustration only. Brief: ${desc}.`;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ projectId: project.id, prompt, target: "project-cover", modelOverride, aspect: "portrait" }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? "Failed");
      setDraft({ ...draft, cover_image_url: json.url });
      toast.success("Cover ready", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed", { id: t });
    } finally {
      setGenCover(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <Panel>
          <SectionTitle>Case Identity</SectionTitle>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Title">
              <Input value={draft.title ?? ""} onChange={(e) => update({ title: e.target.value })} />
            </Field>
            <Field label="Subtitle">
              <Input value={draft.subtitle ?? ""} onChange={(e) => update({ subtitle: e.target.value })} />
            </Field>
            <Field label="Mystery type">
              <Select value={draft.mystery_type ?? ""} onValueChange={(v) => update({ mystery_type: v })}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {MYSTERY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Genre">
              <Select value={draft.genre ?? ""} onValueChange={(v) => update({ genre: v })}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {GENRES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Difficulty">
              <Select value={draft.difficulty ?? ""} onValueChange={(v) => update({ difficulty: v })}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Year">
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
            <Field label="Player role">
              <Input value={draft.player_role ?? ""} onChange={(e) => update({ player_role: e.target.value })} placeholder="e.g. Mossad junior analyst" />
            </Field>
            <Field label="Case goal">
              <Textarea value={draft.case_goal ?? ""} onChange={(e) => update({ case_goal: e.target.value })} rows={3} />
            </Field>
            <Field label="Setting / location">
              <Input value={draft.setting ?? ""} onChange={(e) => update({ setting: e.target.value })} placeholder="e.g. Tel Aviv, 2019" />
            </Field>
            <Field label="Extra selling point (hard games)">
              <Textarea value={draft.selling_point ?? ""} onChange={(e) => update({ selling_point: e.target.value })} rows={2} />
            </Field>
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Production</SectionTitle>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Target document count">
              <Input
                type="number"
                value={draft.target_doc_count ?? ""}
                onChange={(e) => update({ target_doc_count: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
            <Field label="Current phase">
              <Select value={draft.phase} onValueChange={(v) => update({ phase: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PHASES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Packaging notes">
              <Textarea value={draft.packaging_notes ?? ""} onChange={(e) => update({ packaging_notes: e.target.value })} rows={3} />
            </Field>
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
          <div className="mt-3 space-y-2">
            <ImageModelPicker surface="cover" defaultModel="chatgpt-image-2" className="w-full" />
            <Button className="w-full gap-2" onClick={generateCover} disabled={genCover}>
              {genCover ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate cover with AI
            </Button>
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      {children}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Upload, Trash2, UserCircle2 } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";

interface Suspect {
  id: string;
  project_id: string;
  name: string;
  thumbnail_url: string | null;
  alt_thumbnail_url: string | null;
  summary: string | null;
  role_in_case: string | null;
  motives: string | null;
  secrets: string | null;
  contradictions: string | null;
  is_red_herring: boolean;
  position: number;
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
            <button
              key={s.id}
              onClick={() => setSelected(s.id)}
              className="group text-left bg-card border rounded-2xl overflow-hidden shadow-soft hover:shadow-pop hover:-translate-y-0.5 transition-all"
            >
              <div className="aspect-[3/4] bg-muted relative">
                {s.thumbnail_url ? (
                  <img src={s.thumbnail_url} alt={s.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <UserCircle2 className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
                {s.is_red_herring && (
                  <span className="absolute top-2 right-2 text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md bg-destructive text-destructive-foreground">
                    Red herring
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {s.role_in_case || "—"}
                </div>
              </div>
            </button>
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
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => setDraft(suspect), [suspect?.id]);

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
      }).eq("id", next.id);
    }, 500);
  };

  const uploadThumb = async (file: File) => {
    const path = `${suspect.project_id}/${suspect.id}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("suspects").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("suspects").getPublicUrl(path);
    await supabase.from("suspects").update({ thumbnail_url: data.publicUrl }).eq("id", suspect.id);
    setDraft({ ...draft, thumbnail_url: data.publicUrl });
  };

  const remove = async () => {
    if (!confirm("Delete this suspect?")) return;
    await supabase.from("suspects").delete().eq("id", suspect.id);
    onClose();
  };

  return (
    <Dialog open={!!suspect} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Suspect file</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-[140px_1fr] gap-6">
          <div>
            <div className="aspect-[3/4] rounded-xl overflow-hidden border bg-muted">
              {draft.thumbnail_url ? (
                <img src={draft.thumbnail_url} alt={draft.name} className="w-full h-full object-cover" />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <UserCircle2 className="h-10 w-10 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadThumb(e.target.files[0])} />
            <Button variant="outline" size="sm" className="w-full mt-2 gap-2" onClick={() => fileInput.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Change
            </Button>
          </div>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
              <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Role in case</Label>
              <Input value={draft.role_in_case ?? ""} onChange={(e) => update({ role_in_case: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Summary</Label>
              <Textarea rows={3} value={draft.summary ?? ""} onChange={(e) => update({ summary: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Motives</Label>
              <Textarea rows={2} value={draft.motives ?? ""} onChange={(e) => update({ motives: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Secrets</Label>
              <Textarea rows={2} value={draft.secrets ?? ""} onChange={(e) => update({ secrets: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Contradictions</Label>
              <Textarea rows={2} value={draft.contradictions ?? ""} onChange={(e) => update({ contradictions: e.target.value })} />
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
    </Dialog>
  );
}

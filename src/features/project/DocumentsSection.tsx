import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const DOC_TYPES = [
  "Memo", "Interrogation transcript", "Suspect profile", "Map", "Chat log",
  "Analyst report", "Surveillance log", "Receipt", "Evidence form",
  "Schedule", "Notice", "Printout", "Handwritten note", "Newspaper clipping",
  "Technical report", "Photo", "Other",
];
const PRINT_SIZES = ["A3", "A4", "A5", "A6", "Business card", "Custom"];
const STATUSES = ["draft", "in_progress", "review", "final"];

interface Doc {
  id: string;
  project_id: string;
  doc_number: number | null;
  title: string;
  doc_type: string | null;
  print_size: string | null;
  design_instructions: string | null;
  hebrew_content: string | null;
  status: string;
  generated_asset_url: string | null;
  uploaded_asset_url: string | null;
  active_version: string;
  envelope_number: number | null;
}

export function DocumentsSection({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data, refetch } = useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Doc[];
    },
  });

  const addDoc = async () => {
    const docNum = Math.floor(Math.random() * 900) + 100;
    const { error } = await supabase.from("documents").insert({
      project_id: projectId,
      doc_number: docNum,
      title: `Document ${docNum}`,
    });
    if (error) toast.error(error.message);
    else refetch();
  };

  const sel = data?.find((d) => d.id === selected) ?? null;

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-3xl">Documents</h2>
        <Button onClick={addDoc} className="gap-2"><Plus className="h-4 w-4" /> New document</Button>
      </div>
      {!data?.length ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No documents yet.</p>
        </div>
      ) : (
        <div className="bg-card border rounded-2xl overflow-hidden shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Size</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelected(d.id)}
                  className="border-t cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">{d.doc_number ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">{d.title}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{d.doc_type ?? "—"}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{d.print_size ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md ${
                      d.status === "final" ? "bg-success/15 text-success" :
                      d.status === "review" ? "bg-warning/15 text-warning" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DocDialog key={sel?.id} doc={sel} onClose={() => { setSelected(null); refetch(); }} />
    </div>
  );
}

function DocDialog({ doc, onClose }: { doc: Doc | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Doc | null>(doc);
  const saveTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(doc), [doc?.id]);

  if (!doc || !draft) return null;

  const update = (patch: Partial<Doc>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await supabase.from("documents").update({
        title: next.title, doc_type: next.doc_type, print_size: next.print_size,
        design_instructions: next.design_instructions, hebrew_content: next.hebrew_content,
        status: next.status, active_version: next.active_version, envelope_number: next.envelope_number,
      }).eq("id", next.id);
    }, 500);
  };

  const uploadReplacement = async (file: File) => {
    const path = `${doc.project_id}/${doc.id}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    await supabase.from("documents").update({ uploaded_asset_url: data.publicUrl, active_version: "uploaded" }).eq("id", doc.id);
    setDraft({ ...draft, uploaded_asset_url: data.publicUrl, active_version: "uploaded" });
    toast.success("Replacement uploaded");
  };

  const remove = async () => {
    if (!confirm("Delete this document?")) return;
    await supabase.from("documents").delete().eq("id", doc.id);
    onClose();
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Document <span className="text-muted-foreground font-mono text-lg">#{draft.doc_number}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-4 max-h-[65vh] overflow-y-auto pr-2">
          <FieldBlock label="Title">
            <Input value={draft.title} onChange={(e) => update({ title: e.target.value })} />
          </FieldBlock>
          <FieldBlock label="Type">
            <Select value={draft.doc_type ?? ""} onValueChange={(v) => update({ doc_type: v })}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock label="Print size">
            <Select value={draft.print_size ?? ""} onValueChange={(v) => update({ print_size: v })}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{PRINT_SIZES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock label="Status">
            <Select value={draft.status} onValueChange={(v) => update({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </FieldBlock>
          <div className="md:col-span-2">
            <FieldBlock label="Design / graphic instructions">
              <Textarea rows={4} value={draft.design_instructions ?? ""} onChange={(e) => update({ design_instructions: e.target.value })} />
            </FieldBlock>
          </div>
          <div className="md:col-span-2">
            <FieldBlock label="Hebrew content" dir="rtl">
              <Textarea rows={6} value={draft.hebrew_content ?? ""} onChange={(e) => update({ hebrew_content: e.target.value })} dir="rtl" className="text-right" />
            </FieldBlock>
          </div>
          <div className="md:col-span-2 border-t pt-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Final asset</Label>
            <div className="mt-2 flex gap-2">
              <input ref={fileInput} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadReplacement(e.target.files[0])} />
              <Button variant="outline" className="gap-2" onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" /> Upload final file
              </Button>
              {draft.uploaded_asset_url && (
                <a href={draft.uploaded_asset_url} target="_blank" rel="noreferrer" className="text-sm text-accent underline self-center">
                  View current file
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end pt-4 border-t">
          <Button variant="ghost" size="sm" className="text-destructive gap-2" onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" /> Delete document
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldBlock({ label, children, dir }: { label: string; children: React.ReactNode; dir?: string }) {
  return (
    <div className="space-y-1.5" dir={dir}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      {children}
    </div>
  );
}

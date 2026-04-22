import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Trash2, Upload, Wand2, Image as ImageIcon, Loader2, FileDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import jsPDF from "jspdf";

import { ImageModelPicker, getStoredImageModel } from "@/components/ImageModelPicker";

const DESIGN_PLACEHOLDER = `Describe EXACTLY how this document should look. The more specific, the better the result.

Recommended structure (copy + adapt):

GOAL: One fictional in-world prop — e.g. a 1987 "Top Secret" internal letter from the Prime Minister's Office. Cinematic, serious, authentic. Must remain fictional (no real names, emblems, addresses).

CRITICAL TEXT QUALITY:
- All Hebrew real, fluent, grammatical, RTL.
- No gibberish, mirrored letters, lorem ipsum.
- The exact Hebrew below must appear cleanly.

OUTPUT FORMAT:
- Single A4 portrait page, 2480x3508px, 300 DPI.
- Flat archival scan, no hands/desk/background.

VISUAL STYLE:
- Late 1980s Israeli bureaucracy.
- Off-white aged paper, faint fold marks, mild edge wear.
- Typewriter-style body, dark red classification stamps.
- Subtle scan softness, fully legible.
- Punch-hole marks left margin, faint horizontal fold center.

LAYOUT:
1. Top center: header lines.
2. Top right: date, classification, reference number.
3. Top left: recipient block.
4. Bold subject line.
5. 3 formal body paragraphs.
6. Closing + signature block.
7. Distribution list + footer code.
8. Diagonal red stamp "סודי ביותר".
9. Smaller box stamp "לעיני הנמען בלבד".
10. Handwritten marginal note.

TYPOGRAPHY:
- Bold formal Hebrew header.
- Classic serif/typewriter body.
- Distressed red ink stamps.

EXACT HEBREW TEXT TO PLACE:
[paste your full Hebrew block here]

AUTHENTICITY: photocopied 1987 archival memo, NOT modern Canva design.`;

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

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("logic_approved_at, solution_summary").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });

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
      {!project?.logic_approved_at && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm flex items-start gap-3">
          <span className="text-warning text-lg leading-none mt-0.5">⚠</span>
          <div className="flex-1">
            <p className="font-medium">Logic flow not approved yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              You can still generate documents, but it's recommended to design and approve the case logic first on the <strong>Case Board → Logic Flow</strong> tab. That way every document fits a coherent solution.
            </p>
          </div>
        </div>
      )}
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
  const [genText, setGenText] = useState(false);
  const [genImage, setGenImage] = useState(false);
  const [draft, setDraft] = useState<Doc | null>(doc);
  const [genText, setGenText] = useState(false);
  const [genImage, setGenImage] = useState(false);
  const [imageModel, setImageModel] = useState<string>("chatgpt-image");
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

  const generate = async (mode: "text" | "image") => {
    const setter = mode === "text" ? setGenText : setGenImage;
    setter(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ documentId: doc.id, mode, imageModelOverride: mode === "image" ? imageModel : undefined }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: "Failed" }));
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits.");
        else toast.error(e.error ?? "Generation failed");
        return;
      }
      const data = await resp.json();
      if (mode === "text" && data.hebrew_content) {
        setDraft((d) => d ? { ...d, hebrew_content: data.hebrew_content, status: "review" } : d);
      }
      if (mode === "image" && data.url) {
        setDraft((d) => d ? { ...d, generated_asset_url: data.url, active_version: "generated", status: "review" } : d);
      }
      toast.success(`${mode === "text" ? "Hebrew content" : "Document image"} generated`);
    } finally {
      setter(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this document?")) return;
    await supabase.from("documents").delete().eq("id", doc.id);
    onClose();
  };

  const saveAsPdf = async () => {
    const url = draft.generated_asset_url;
    if (!url) return;
    toast.loading("Building PDF…", { id: "pdf" });
    try {
      const blob = await (await fetch(url)).blob();
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = dataUrl;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

      const sizeMap: Record<string, [number, number]> = {
        A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
        "Business card": [85, 55],
      };
      const [pw, ph] = sizeMap[draft.print_size ?? "A4"] ?? [210, 297];
      const orientation = pw > ph ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "mm", format: [pw, ph] });

      // Fit image with letterboxing
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageW / img.width, pageH / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      const x = (pageW - w) / 2;
      const y = (pageH - h) / 2;
      pdf.addImage(dataUrl, "PNG", x, y, w, h);
      pdf.save(`${(draft.title || "document").replace(/[^\p{L}\p{N}_\- ]+/gu, "_")}.pdf`);
      toast.success("PDF saved", { id: "pdf" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed", { id: "pdf" });
    }
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Document <span className="text-muted-foreground font-mono text-lg">#{draft.doc_number}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-4 max-h-[78vh] overflow-y-auto pr-2">
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
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Structure beats brevity. Include GOAL, FORMAT, VISUAL STYLE, LAYOUT, TYPOGRAPHY, EXACT HEBREW TEXT, AUTHENTICITY rules.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {(draft.design_instructions ?? "").length.toLocaleString()} chars
                  </span>
                  {!draft.design_instructions && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => update({ design_instructions: DESIGN_PLACEHOLDER })}
                    >
                      Insert template
                    </Button>
                  )}
                </div>
              </div>
              <Textarea
                rows={28}
                value={draft.design_instructions ?? ""}
                onChange={(e) => update({ design_instructions: e.target.value })}
                placeholder={DESIGN_PLACEHOLDER}
                className="font-mono text-xs leading-relaxed min-h-[520px] resize-y"
              />
            </FieldBlock>
          </div>
          <div className="md:col-span-2">
            <FieldBlock label="Hebrew content" dir="rtl">
              <div className="flex flex-wrap gap-2 mb-2 items-center" dir="ltr">
                <Button size="sm" variant="outline" className="gap-2" onClick={() => generate("text")} disabled={genText}>
                  {genText ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  Generate Hebrew content
                </Button>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Select value={imageModel} onValueChange={setImageModel}>
                    <SelectTrigger className="h-8 text-xs w-[260px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IMAGE_MODELS.map((m) => <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => generate("image")} disabled={genImage}>
                    {genImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                    Generate document image
                  </Button>
                </div>
              </div>
              <Textarea rows={6} value={draft.hebrew_content ?? ""} onChange={(e) => update({ hebrew_content: e.target.value })} dir="rtl" className="text-right" />
            </FieldBlock>
          </div>
          {draft.generated_asset_url && (
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Generated document image</Label>
                <Button size="sm" variant="outline" className="gap-2" onClick={saveAsPdf}>
                  <FileDown className="h-3.5 w-3.5" /> Save as PDF
                </Button>
              </div>
              <img src={draft.generated_asset_url} alt="" className="rounded-lg border w-full max-h-96 object-contain bg-muted" />
            </div>
          )}
          <div className="md:col-span-2 border-t pt-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Final asset</Label>
            <div className="mt-2 flex gap-2 items-center">
              <input ref={fileInput} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadReplacement(e.target.files[0])} />
              <Button variant="outline" className="gap-2" onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" /> Upload final file
              </Button>
              {draft.uploaded_asset_url && (
                <a href={draft.uploaded_asset_url} target="_blank" rel="noreferrer" className="text-sm text-accent underline">
                  View uploaded file
                </a>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground uppercase tracking-widest">
                Active: {draft.active_version}
              </span>
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

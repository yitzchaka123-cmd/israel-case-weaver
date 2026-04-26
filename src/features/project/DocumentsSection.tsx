import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Trash2, Upload, Wand2, Image as ImageIcon, Loader2, FileDown, FileType, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import jsPDF from "jspdf";

import { ImageModelPicker, getStoredImageModel } from "@/components/ImageModelPicker";
import { PromptWriterModelPicker, getStoredWriterModel } from "@/components/PromptWriterModelPicker";
import { AssistantOriginBadge } from "@/components/AssistantOriginBadge";
import { Sparkles } from "lucide-react";
import { DocumentPromptAssistant } from "@/components/DocumentPromptAssistant";
import { Badge } from "@/components/ui/badge";

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
  generated_document_url?: string | null;
  generated_pdf_url?: string | null;
  document_format?: string | null;
  document_provider?: string | null;
  document_model?: string | null;
  document_skill_id?: string | null;
  document_preview_url?: string | null;
  uploaded_asset_url: string | null;
  active_version: string;
  envelope_number: number | null;
  created_by_message_id: string | null;
}

export function DocumentsSection({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("logic_approved_at, solution_summary, game_language").eq("id", projectId).single();
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
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelected(d.id)}
                  className="border-t cursor-pointer hover:bg-muted/40 transition-colors group"
                >
                  <td className="px-4 py-3 font-mono text-xs">{d.doc_number ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {d.title}
                      <AssistantOriginBadge messageId={d.created_by_message_id} label="" />
                    </span>
                  </td>
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
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
                        const { error } = await supabase.from("documents").delete().eq("id", d.id);
                        if (error) toast.error(error.message);
                        else { toast.success("Document deleted"); refetch(); }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      aria-label="Delete document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DocDialog
        key={sel?.id}
        doc={sel}
        gameLanguage={project?.game_language ?? "Hebrew"}
        onClose={() => { setSelected(null); refetch(); }}
      />
    </div>
  );
}

function DocDialog({ doc, gameLanguage, onClose }: { doc: Doc | null; gameLanguage: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Doc | null>(doc);
  const [genText, setGenText] = useState(false);
  const [genImage, setGenImage] = useState(false);
  const [genDocument, setGenDocument] = useState(false);
  const [draftingPrompt, setDraftingPrompt] = useState(false);
  const [imageQuality, setImageQuality] = useState<"low" | "medium" | "high">("medium");
  const [documentFormat, setDocumentFormat] = useState<"pdf" | "docx" | "pptx" | "xlsx">("pdf");
  const [selectedImageModel, setSelectedImageModel] = useState<string>(
    () => getStoredImageModel("document", "chatgpt-image"),
  );
  const saveTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: filePrompt } = useQuery({
    queryKey: ["document-file-prompt", doc?.id],
    queryFn: async () => {
      if (!doc) return null;
      const { data, error } = await supabase
        .from("prompts")
        .select("final_prompt, provider, model, created_at")
        .eq("target_id", doc.id)
        .eq("scope", "document_file")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { final_prompt: string | null; provider: string | null; model: string | null; created_at: string } | null;
    },
    enabled: !!doc?.id,
  });

  const { data: latestDocumentAttempt } = useQuery({
    queryKey: ["document-file-attempt", doc?.id],
    queryFn: async () => {
      if (!doc) return null;
      const { data, error } = await supabase
        .from("media_assets")
        .select("status, error_message, provider, model, effective_model, skill_name, skill_source, document_format, mime_type, url, preview_url, created_at")
        .eq("source_document_id", doc.id)
        .eq("asset_type", "document")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { status: string | null; error_message: string | null; provider: string | null; model: string | null; effective_model: string | null; skill_name: string | null; skill_source: string | null; document_format: string | null; mime_type: string | null; url: string | null; preview_url: string | null; created_at: string } | null;
    },
    enabled: !!doc?.id,
  });

  useEffect(() => setDraft(doc), [doc?.id]);

  // Refresh selected image model whenever the picker writes back to localStorage
  useEffect(() => {
    if (!doc) return;
    const tick = () => setSelectedImageModel(getStoredImageModel("document", "chatgpt-image"));
    const i = window.setInterval(tick, 800);
    return () => window.clearInterval(i);
  }, [doc?.id]);

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

  const generate = async (mode: "text" | "image" | "document") => {
    const setter = mode === "text" ? setGenText : mode === "image" ? setGenImage : setGenDocument;
    setter(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          documentId: doc.id,
          mode,
          imageModelOverride: mode === "image" ? getStoredImageModel("document", "chatgpt-image") : undefined,
          quality: mode === "image" ? imageQuality : undefined,
          documentFormat: mode === "document" ? documentFormat : undefined,
        }),
      });

      // Try to parse JSON safely — when the worker is killed mid-response the
      // body can be malformed and would otherwise blow up the dialog.
      let payload: { error?: string; hebrew_content?: string; url?: string; documentUrl?: string } = {};
      try {
        payload = await resp.json();
      } catch {
        payload = { error: "The server didn't return a valid response (it may have timed out). Try Medium quality, or switch to a Nano Banana model." };
      }

      if (!resp.ok) {
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits.");
        else if (resp.status === 504) toast.error(payload.error ?? "Generation timed out.", { duration: 8000 });
        else toast.error(payload.error ?? "Generation failed", { duration: 8000 });
        return;
      }
      if (mode === "text" && payload.hebrew_content) {
        setDraft((d) => d ? { ...d, hebrew_content: payload.hebrew_content!, status: "review" } : d);
      }
      if (mode === "image" && payload.url) {
        setDraft((d) => d ? { ...d, generated_asset_url: payload.url!, active_version: "generated", status: "review" } : d);
      }
      if (mode === "document" && payload.documentUrl) {
        setDraft((d) => d ? { ...d, generated_document_url: payload.documentUrl!, document_format: documentFormat, status: "review" } : d);
      }
      toast.success(mode === "text" ? "Hebrew content generated" : mode === "image" ? "Document image generated" : "Document file generated");
    } catch (e) {
      console.error("generate-document call failed", e);
      toast.error(e instanceof Error ? e.message : "Generation failed", { duration: 8000 });
    } finally {
      setter(false);
    }
  };

  const generateOutputType = async (type: "image" | "document" | "both") => {
    if (type === "both") {
      await generate("document");
      await generate("image");
      return;
    }
    await generate(type);
  };

  const copyFilePrompt = async () => {
    if (!filePrompt?.final_prompt) return;
    await navigator.clipboard.writeText(filePrompt.final_prompt);
    toast.success("Document prompt copied");
  };

  const remove = async () => {
    if (!confirm("Delete this document?")) return;
    await supabase.from("documents").delete().eq("id", doc.id);
    onClose();
  };

  // Draft a fresh design-instructions / image prompt for this document using
  // the project context. Replaces any existing draft.
  const draftPrompt = async () => {
    setDraftingPrompt(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const writerModel = getStoredWriterModel("document");
      const hint = [
        draft.title && `Document title: ${draft.title}`,
        draft.doc_type && `Type: ${draft.doc_type}`,
        draft.print_size && `Print size: ${draft.print_size}`,
        draft.hebrew_content && `Hebrew text to include: ${draft.hebrew_content}`,
      ].filter(Boolean).join(". ");
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-image-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          projectId: doc.project_id,
          category: "external",
          hint: hint || undefined,
          currentPrompt: draft.design_instructions ?? undefined,
          writerModel: writerModel === "__project" ? undefined : writerModel,
          userId: session?.user?.id,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Couldn't draft a prompt");
        return;
      }
      update({ design_instructions: json.prompt });
      toast.success("Prompt drafted — review before generating");
    } finally {
      setDraftingPrompt(false);
    }
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
          <DialogTitle className="font-display text-2xl flex items-center gap-2 flex-wrap">
            Document <span className="text-muted-foreground font-mono text-lg">#{draft.doc_number}</span>
            <AssistantOriginBadge messageId={draft.created_by_message_id} />
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
            <DocumentPromptAssistant
              projectId={doc.project_id}
              target={{ kind: "document", documentId: doc.id }}
              design={draft.design_instructions ?? ""}
              content={draft.hebrew_content ?? ""}
              onChange={({ design, content }) => update({ design_instructions: design, hebrew_content: content })}
              onAutoGenerate={async () => { await generate("image"); }}
              gameLanguage={gameLanguage}
              mode="inline"
            />
            {!draft.design_instructions && (
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => update({ design_instructions: DESIGN_PLACEHOLDER })}
                >
                  Insert template
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  Or just type instructions above and click <strong>Generate prompt</strong>.
                </span>
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <FieldBlock label="Generate output">
              <div className="flex flex-wrap items-center gap-2" dir="ltr">
                <ImageModelPicker surface="document" defaultModel="chatgpt-image" />
                <Select value={imageQuality} onValueChange={(v) => setImageQuality(v as "low" | "medium" | "high")}>
                  <SelectTrigger className="h-8 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low (fastest)</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High (slow)</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => generate("image")} disabled={genImage}>
                  {genImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  Generate document image
                </Button>
                <Select value={documentFormat} onValueChange={(v) => setDocumentFormat(v as "pdf" | "docx" | "pptx" | "xlsx")}>
                  <SelectTrigger className="h-8 w-[98px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="docx">DOCX</SelectItem>
                    <SelectItem value="pptx">PPTX</SelectItem>
                    <SelectItem value="xlsx">XLSX</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => generate("document")} disabled={genDocument}>
                  {genDocument ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileType className="h-3.5 w-3.5" />}
                  Generate file
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2" dir="ltr">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Combined</span>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => generateOutputType("both")} disabled={genImage || genDocument}><Wand2 className="h-3 w-3" /> Image + file</Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-[11px]" onClick={() => generate("text")} disabled={genText} title="Legacy: regenerate just the content text using the old single-prompt flow.">
                  {genText ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  Regenerate content only
                </Button>
              </div>
              {selectedImageModel === "chatgpt-image-2" && (
                <div className="mt-2 text-[11px] text-muted-foreground rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5" dir="ltr">
                  <strong className="text-warning">Heads up:</strong> <code>chatgpt-image-2</code> requires a <em>verified OpenAI organization</em> and is slower at High quality. If generation fails or times out, switch the model to <strong>ChatGPT Image 1</strong> or <strong>Nano Banana</strong>, or drop quality to Medium.
                </div>
              )}
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
          {(draft.generated_document_url || draft.generated_pdf_url) && (
            <div className="md:col-span-2 rounded-lg border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Generated document file</Label>
                <p className="text-sm truncate">{(draft.document_format ?? "file").toUpperCase()} • {draft.document_model ?? draft.document_provider ?? "Selected model"}</p>
              </div>
              <a href={draft.generated_document_url ?? draft.generated_pdf_url ?? "#"} target="_blank" rel="noreferrer" className="text-sm text-accent underline shrink-0">Open file</a>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {draft.document_format && <Badge variant="outline" className="text-[10px]">{draft.document_format.toUpperCase()}</Badge>}
                {draft.document_provider && <Badge variant="outline" className="text-[10px]">{draft.document_provider}</Badge>}
                {draft.document_model && <Badge variant="secondary" className="text-[10px]">{draft.document_model}</Badge>}
                {draft.document_skill_id && <Badge variant="outline" className="text-[10px]">Skill {draft.document_skill_id}</Badge>}
              </div>
              {latestDocumentAttempt?.preview_url && <img src={latestDocumentAttempt.preview_url} alt="Document preview" className="max-h-56 w-full rounded-md border bg-background object-contain" />}
            </div>
          )}
          {latestDocumentAttempt?.status === "failed" && (
            <div className="md:col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="mr-auto text-xs uppercase tracking-wider text-destructive font-medium">Latest document-file attempt failed</Label>
                {latestDocumentAttempt.document_format && <Badge variant="outline" className="text-[10px]">{latestDocumentAttempt.document_format.toUpperCase()}</Badge>}
                {latestDocumentAttempt.provider && <Badge variant="outline" className="text-[10px]">{latestDocumentAttempt.provider}</Badge>}
                {latestDocumentAttempt.skill_name && <Badge variant="secondary" className="text-[10px]">{latestDocumentAttempt.skill_name}</Badge>}
              </div>
              <p className="text-xs text-destructive">{latestDocumentAttempt.error_message ?? "The selected model did not return a downloadable document file."}</p>
            </div>
          )}
          {filePrompt?.final_prompt && (
            <div className="md:col-span-2 rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">PDF/document generation prompt</Label>
                  <p className="text-[11px] text-muted-foreground">{filePrompt.provider ?? "provider"} · {filePrompt.model ?? "model"}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={copyFilePrompt}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <p className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">{filePrompt.final_prompt}</p>
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

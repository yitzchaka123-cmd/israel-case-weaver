import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Copy, ExternalLink, FileText, Image as ImageIcon, Package, Search, Video } from "lucide-react";
import { toast } from "sonner";
import { AssetLightbox, type LightboxAsset } from "./assistant/AssetLightbox";

interface MediaAsset {
  id: string;
  category: string;
  title: string | null;
  url: string | null;
  mime_type: string | null;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  effective_model: string | null;
  skill_id?: string | null;
  skill_source?: string | null;
  skill_name?: string | null;
  document_format?: string | null;
  asset_type?: string | null;
  status?: string | null;
  error_message?: string | null;
  preview_url?: string | null;
  created_at: string;
}

interface DocumentAsset {
  id: string;
  title: string;
  doc_type: string | null;
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
  updated_at: string;
}

interface ProjectMedia {
  title: string;
  cover_image_url: string | null;
  cover_effective_model: string | null;
}

type LibraryItem = {
  id: string;
  title: string;
  type: string;
  status: "selected" | "generated" | "uploaded" | "prompt" | "failed";
  source: string;
  url: string | null;
  mime: string | null;
  model: string | null;
  provider?: string | null;
  prompt?: string | null;
  previewUrl?: string | null;
  skill?: string | null;
  skillSource?: string | null;
  error?: string | null;
  createdAt: string;
};

const ALL = "all";

export function MediaLibrarySection({ projectId }: { projectId: string }) {
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [sourceFilter, setSourceFilter] = useState(ALL);
  const [lightbox, setLightbox] = useState<LightboxAsset | null>(null);

  const { data } = useQuery({
    queryKey: ["case-media-library", projectId],
    queryFn: async () => {
      const [projectRes, mediaRes, docsRes] = await Promise.all([
        supabase.from("projects").select("title, cover_image_url, cover_effective_model").eq("id", projectId).single(),
        supabase.from("media_assets").select("id, category, title, url, mime_type, prompt, provider, model, effective_model, skill_id, skill_source, skill_name, document_format, asset_type, status, error_message, preview_url, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
        supabase.from("documents").select("id, title, doc_type, generated_asset_url, generated_document_url, generated_pdf_url, document_format, document_provider, document_model, document_skill_id, document_preview_url, uploaded_asset_url, active_version, updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }),
      ]);
      if (projectRes.error) throw projectRes.error;
      if (mediaRes.error) throw mediaRes.error;
      if (docsRes.error) throw docsRes.error;
      return {
        project: projectRes.data as ProjectMedia,
        media: (mediaRes.data ?? []) as MediaAsset[],
        documents: (docsRes.data ?? []) as DocumentAsset[],
      };
    },
  });

  const items = useMemo<LibraryItem[]>(() => {
    const list: LibraryItem[] = [];
    if (data?.project.cover_image_url) {
      list.push({
        id: "project-cover",
        title: `${data.project.title} cover`,
        type: "cover",
        status: "selected",
        source: "Project",
        url: data.project.cover_image_url,
        mime: "image/*",
        model: data.project.cover_effective_model,
        createdAt: new Date().toISOString(),
      });
    }
    for (const asset of data?.media ?? []) {
      list.push({
        id: asset.id,
        title: asset.title ?? asset.category,
        type: asset.document_format ?? asset.asset_type ?? asset.category,
        status: (asset.status === "failed" ? "failed" : asset.provider === "upload" ? "uploaded" : asset.url ? "generated" : "prompt"),
        source: "Media asset",
        url: asset.url,
        mime: asset.mime_type,
        model: asset.effective_model ?? asset.model,
        provider: asset.provider,
        prompt: asset.prompt,
        previewUrl: asset.preview_url,
        skill: asset.skill_name ?? asset.skill_id,
        skillSource: asset.skill_source,
        error: asset.error_message,
        createdAt: asset.created_at,
      });
    }
    for (const doc of data?.documents ?? []) {
      const isDocumentFile = Boolean(doc.generated_document_url || doc.generated_pdf_url) && doc.active_version !== "uploaded";
      const url = doc.active_version === "uploaded"
        ? doc.uploaded_asset_url
        : isDocumentFile
          ? (doc.generated_document_url ?? doc.generated_pdf_url ?? null)
          : doc.generated_asset_url;
      if (!url) continue;
      list.push({
        id: doc.id,
        title: doc.title,
        type: isDocumentFile ? (doc.document_format ?? "document") : (doc.doc_type ?? "document"),
        status: doc.active_version === "uploaded" ? "uploaded" : "selected",
        source: "Document",
        url,
        mime: isDocumentFile && (doc.document_format ?? "pdf") === "pdf" ? "application/pdf" : "image/*",
        model: doc.document_skill_id ? `${doc.document_model ?? doc.document_provider ?? "Claude"} + ${doc.document_skill_id}` : (doc.document_model ?? doc.document_provider ?? null),
        provider: doc.document_provider,
        previewUrl: doc.document_preview_url ?? doc.generated_asset_url,
        createdAt: doc.updated_at,
      });
    }
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [data]);

  const types = Array.from(new Set(items.map((item) => item.type))).sort();
  const sources = Array.from(new Set(items.map((item) => item.source))).sort();
  const filtered = items.filter((item) =>
    (statusFilter === ALL || item.status === statusFilter) &&
    (typeFilter === ALL || item.type === typeFilter) &&
    (sourceFilter === ALL || item.source === sourceFilter),
  );

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div>
        <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-1">Media</div>
        <h2 className="font-display text-3xl">Case media library</h2>
        <p className="text-sm text-muted-foreground mt-1">Every selected, generated, uploaded, and saved media item across this case.</p>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-soft grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <FilterSelect label="Status" value={statusFilter} onValueChange={setStatusFilter} options={[ALL, "selected", "generated", "uploaded", "prompt", "failed"]} />
        <FilterSelect label="Type" value={typeFilter} onValueChange={setTypeFilter} options={[ALL, ...types]} />
        <FilterSelect label="Source" value={sourceFilter} onValueChange={setSourceFilter} options={[ALL, ...sources]} />
        <Button variant="outline" onClick={() => { setStatusFilter(ALL); setTypeFilter(ALL); setSourceFilter(ALL); }} className="self-end gap-2">
          <Search className="h-4 w-4" /> Reset
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center text-muted-foreground">No media matches these filters.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => <LibraryCard key={`${item.source}-${item.id}`} item={item} onOpenAsset={setLightbox} />)}
        </div>
      )}
      <AssetLightbox asset={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function FilterSelect({ label, value, onValueChange, options }: { label: string; value: string; onValueChange: (value: string) => void; options: string[] }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{option === ALL ? "All" : option}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function LibraryCard({ item, onOpenAsset }: { item: LibraryItem; onOpenAsset: (asset: LightboxAsset) => void }) {
  const isVideo = item.mime?.startsWith("video");
  const isPdf = item.mime === "application/pdf";
  const isDocumentFile = item.mime?.includes("pdf") || ["docx", "pptx", "xlsx"].includes(item.type.toLowerCase());
  const Icon = item.source === "Document" ? FileText : item.type.includes("cover") || item.type.includes("back") ? Package : isVideo ? Video : ImageIcon;
  const copyPrompt = async () => {
    if (!item.prompt) return;
    try {
      await navigator.clipboard.writeText(item.prompt);
      toast.success("Prompt copied");
    } catch {
      toast.error("Failed to copy prompt");
    }
  };
  const openAsset = () => {
    if (!item.url) return;
    onOpenAsset({ url: item.url, title: item.title, prompt: item.prompt, mimeType: item.mime, previewUrl: item.previewUrl });
  };

  return (
    <article className="rounded-2xl border bg-card overflow-hidden shadow-soft">
      <button type="button" onClick={openAsset} disabled={!item.url} className="aspect-[4/3] bg-muted relative overflow-hidden block w-full text-left disabled:cursor-default">
        {item.url && isVideo ? <video src={item.url} className="h-full w-full object-cover" /> : item.url && !isPdf ? <img src={item.previewUrl ?? item.url} alt={item.title} className="h-full w-full object-cover" /> : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground"><Icon className="h-8 w-8" /></div>
        )}
        <Badge variant={item.status === "failed" ? "destructive" : "secondary"} className="absolute left-2 top-2 capitalize">{item.status}</Badge>
        {isDocumentFile && <Badge variant="outline" className="absolute right-2 top-2 bg-background/85">{item.type.toUpperCase()}</Badge>}
      </button>
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{item.title}</h3>
            <p className="text-[11px] text-muted-foreground truncate">{item.source} · {item.type} · {new Date(item.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground truncate">{[item.provider, item.model].filter(Boolean).join(" · ") || item.mime || "Asset"}</span>
          {item.url && <button type="button" onClick={openAsset} className="text-xs text-accent inline-flex items-center gap-1 hover:underline"><ExternalLink className="h-3 w-3" /> Preview</button>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {item.mime && <Badge variant="outline" className="text-[10px]">{item.mime.includes("pdf") ? "PDF" : item.mime.split("/")[1] ?? item.mime}</Badge>}
          {item.provider && <Badge variant="outline" className="text-[10px]">{item.provider}</Badge>}
          {item.skill && <Badge variant="secondary" className="text-[10px]">{item.skill}</Badge>}
          {item.skillSource && item.skillSource !== "none" && <Badge variant="outline" className="text-[10px]">{item.skillSource}</Badge>}
        </div>
        {item.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive line-clamp-2">{item.error}</p>}
        {item.prompt && (
          <div className="rounded-lg border bg-muted/30 p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Document prompt</span>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 gap-1 text-[11px]" onClick={copyPrompt}>
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
            <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">{item.prompt}</p>
          </div>
        )}
      </div>
    </article>
  );
}
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

function safeName(s: string) {
  return (s || "untitled").replace(/[^\p{L}\p{N}_\- ]+/gu, "_").slice(0, 80);
}

export async function exportProjectPackage(projectId: string) {
  toast.loading("Packaging project…", { id: "export" });
  try {
    const [{ data: project }, { data: suspects }, { data: docs }, { data: nodes }, { data: edges }, { data: envelopes }, { data: hints }, { data: media }, { data: prompts }, { data: chat }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("suspects").select("*").eq("project_id", projectId),
      supabase.from("documents").select("*").eq("project_id", projectId),
      supabase.from("canvas_nodes").select("*").eq("project_id", projectId),
      supabase.from("canvas_edges").select("*").eq("project_id", projectId),
      supabase.from("envelopes").select("*").eq("project_id", projectId),
      supabase.from("hints").select("*").eq("project_id", projectId),
      supabase.from("media_assets").select("*").eq("project_id", projectId),
      supabase.from("prompts").select("*").eq("project_id", projectId),
      supabase.from("chat_messages").select("*").eq("project_id", projectId),
    ]);
    if (!project) throw new Error("Project not found");

    const zip = new JSZip();
    zip.file("project.json", JSON.stringify({ project, suspects, docs, nodes, edges, envelopes, hints, media, prompts, chat }, null, 2));

    // Documents folder
    const docsFolder = zip.folder("documents");
    for (const d of docs ?? []) {
      const base = `${d.doc_number ?? "x"}_${safeName(d.title)}`;
      if (d.hebrew_content) {
        docsFolder?.file(`${base}.txt`, d.hebrew_content);
      }
      const assetUrl = d.active_version === "uploaded" ? d.uploaded_asset_url : d.generated_asset_url;
      if (assetUrl) {
        const blob = await fetchBlob(assetUrl);
        if (blob) {
          const ext = (blob.type.split("/")[1] ?? "bin").split(";")[0];
          docsFolder?.file(`${base}.${ext}`, blob);
        }
      }
    }

    // Media folder
    const mediaFolder = zip.folder("media");
    for (const m of media ?? []) {
      const base = `${m.category}_${safeName(m.title ?? "asset")}_${m.id.slice(0, 6)}`;
      if (m.prompt) mediaFolder?.file(`${base}.prompt.txt`, m.prompt);
      if (m.url) {
        const blob = await fetchBlob(m.url);
        if (blob) {
          const ext = (blob.type.split("/")[1] ?? "bin").split(";")[0];
          mediaFolder?.file(`${base}.${ext}`, blob);
        }
      }
    }

    // Prompts dump
    zip.file("prompts.json", JSON.stringify(prompts ?? [], null, 2));

    // Suspects
    const susFolder = zip.folder("suspects");
    for (const s of suspects ?? []) {
      const base = safeName(s.name);
      susFolder?.file(`${base}.json`, JSON.stringify(s, null, 2));
      if (s.thumbnail_url) {
        const blob = await fetchBlob(s.thumbnail_url);
        if (blob) susFolder?.file(`${base}.${(blob.type.split("/")[1] ?? "png").split(";")[0]}`, blob);
      }
    }

    const readme = `# ${project.title}\n\n${project.subtitle ?? ""}\n\nPhase: ${project.phase}\nDifficulty: ${project.difficulty ?? "—"}\nSuspects: ${(suspects ?? []).length}\nDocuments: ${(docs ?? []).length}\n`;
    zip.file("README.md", readme);

    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `${safeName(project.title)}.zip`);
    toast.success("Project exported", { id: "export" });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Export failed", { id: "export" });
  }
}

export async function exportDocumentsOnly(projectId: string) {
  toast.loading("Exporting documents…", { id: "export" });
  try {
    const { data: docs } = await supabase.from("documents").select("*").eq("project_id", projectId);
    const zip = new JSZip();
    for (const d of docs ?? []) {
      const base = `${d.doc_number ?? "x"}_${safeName(d.title)}`;
      if (d.hebrew_content) zip.file(`${base}.txt`, d.hebrew_content);
      const assetUrl = d.active_version === "uploaded" ? d.uploaded_asset_url : d.generated_asset_url;
      if (assetUrl) {
        const blob = await fetchBlob(assetUrl);
        if (blob) {
          const ext = (blob.type.split("/")[1] ?? "bin").split(";")[0];
          zip.file(`${base}.${ext}`, blob);
        }
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `documents-${projectId.slice(0, 8)}.zip`);
    toast.success("Documents exported", { id: "export" });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Export failed", { id: "export" });
  }
}

export async function exportPromptsOnly(projectId: string) {
  try {
    const { data: prompts } = await supabase.from("prompts").select("*").eq("project_id", projectId);
    const blob = new Blob([JSON.stringify(prompts ?? [], null, 2)], { type: "application/json" });
    saveAs(blob, `prompts-${projectId.slice(0, 8)}.json`);
    toast.success("Prompts exported");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Export failed");
  }
}

export async function exportMediaOnly(projectId: string) {
  toast.loading("Exporting media…", { id: "export" });
  try {
    const { data: media } = await supabase.from("media_assets").select("*").eq("project_id", projectId);
    const zip = new JSZip();
    for (const m of media ?? []) {
      const base = `${m.category}_${safeName(m.title ?? "asset")}_${m.id.slice(0, 6)}`;
      if (m.prompt) zip.file(`${base}.prompt.txt`, m.prompt);
      if (m.url) {
        const blob = await fetchBlob(m.url);
        if (blob) {
          const ext = (blob.type.split("/")[1] ?? "bin").split(";")[0];
          zip.file(`${base}.${ext}`, blob);
        }
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `media-${projectId.slice(0, 8)}.zip`);
    toast.success("Media exported", { id: "export" });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Export failed", { id: "export" });
  }
}

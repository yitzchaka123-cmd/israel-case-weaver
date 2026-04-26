import JSZip from "jszip";
import pkg from "file-saver";
const { saveAs } = pkg;
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Pick the URL the user actively chose for export. Priority follows
// `documents.active_version`: uploaded > generated_document (PDF/file) > generated (image).
// Falls through if the chosen source is missing.
function pickActiveAsset(d: {
  active_version?: string | null;
  uploaded_asset_url?: string | null;
  generated_document_url?: string | null;
  generated_pdf_url?: string | null;
  generated_asset_url?: string | null;
}): string | null {
  const av = d.active_version ?? "generated";
  const docFile = d.generated_document_url ?? d.generated_pdf_url ?? null;
  if (av === "uploaded") return d.uploaded_asset_url ?? docFile ?? d.generated_asset_url ?? null;
  if (av === "generated_document") return docFile ?? d.generated_asset_url ?? d.uploaded_asset_url ?? null;
  return d.generated_asset_url ?? docFile ?? d.uploaded_asset_url ?? null;
}

// Mirror of pickActiveAsset for image-only surfaces (suspect / hint / cover).
function pickActiveImage(av: string | null | undefined, generated: string | null | undefined, uploaded: string | null | undefined): string | null {
  if ((av ?? "generated") === "uploaded") return uploaded ?? generated ?? null;
  return generated ?? uploaded ?? null;
}

// Build the same project-package zip used by exportProjectPackage and return
// it as a Blob + suggested file name. Shared by the local download path and
// the "Save case to Google Drive" path so both produce identical archives.
async function buildProjectPackage(projectId: string): Promise<{ blob: Blob; fileName: string; title: string } | null> {
  const [{ data: project }, { data: suspects }, { data: docs }, { data: nodes }, { data: edges }, { data: envelopes }, { data: hints }, { data: media }, { data: prompts }, { data: chat }, { data: marketing }] = await Promise.all([
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
    supabase.from("project_marketing").select("*").eq("project_id", projectId).maybeSingle(),
  ]);
  if (!project) return null;

  const zip = new JSZip();
  zip.file("project.json", JSON.stringify({ project, suspects, docs, nodes, edges, envelopes, hints, media, prompts, chat, marketing }, null, 2));

  const docsFolder = zip.folder("documents");
  for (const d of docs ?? []) {
    const base = `${d.doc_number ?? "x"}_${safeName(d.title)}`;
    if (d.hebrew_content) docsFolder?.file(`${base}.txt`, d.hebrew_content);
    const assetUrl = pickActiveAsset(d);
    if (assetUrl) {
      const blob = await fetchBlob(assetUrl);
      if (blob) {
        const ext = (blob.type.split("/")[1] ?? "bin").split(";")[0];
        docsFolder?.file(`${base}.${ext}`, blob);
      }
    }
  }
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

  if (marketing) {
    const packagingFolder = zip.folder("packaging");
    packagingFolder?.file("box-text.json", JSON.stringify(marketing, null, 2));
    packagingFolder?.file("box-text.txt", formatBoxText(marketing as Record<string, unknown>));
    const qrUrl = typeof marketing.qr_code_url === "string" ? marketing.qr_code_url : null;
    if (qrUrl) {
      const blob = await fetchBlob(qrUrl);
      if (blob) packagingFolder?.folder("qr")?.file(`mini-movie-preview.${(blob.type.split("/")[1] ?? "png").split(";")[0]}`, blob);
    }
  }

  zip.file("prompts.json", JSON.stringify(prompts ?? [], null, 2));
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
  return { blob, fileName: `${safeName(project.title)}.zip`, title: project.title };
}

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

function readText(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : "—";
}

function formatBoxText(row: Record<string, unknown>) {
  return `FRONT COVER TEXT
Title note:
${readText(row, "front_title_note")}

Tagline:
${readText(row, "tagline")}

Front hook:
${readText(row, "front_subtext")}

Bottom explanation:
${readText(row, "front_bottom_explanation")}

Company slogan:
${readText(row, "front_company_slogan")}

Logo note:
${readText(row, "front_logo_note")}

BACK COVER TEXT
Headline:
${readText(row, "back_headline")}

Teaser:
${readText(row, "back_teaser")}

Main description:
${readText(row, "back_body")}

What's in the box:
${readText(row, "back_whats_in_box")}

How to play:
${readText(row, "back_how_to_play")}

Feature bullets:
${readText(row, "back_feature_bullets")}

Specs:
${readText(row, "back_specs")}

Content note:
${readText(row, "back_content_note")}

Footer text:
${readText(row, "back_footer_text")}

MINI MOVIE QR
URL:
${readText(row, "mini_movie_url")}

Label:
${readText(row, "qr_label")}

Helper text:
${readText(row, "qr_helper_text")}

QR image:
${readText(row, "qr_code_url")}
`;
}

export async function exportProjectPackage(projectId: string) {
  toast.loading("Packaging project…", { id: "export" });
  try {
    const built = await buildProjectPackage(projectId);
    if (!built) throw new Error("Project not found");
    saveAs(built.blob, built.fileName);
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
      const assetUrl = pickActiveAsset(d);
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

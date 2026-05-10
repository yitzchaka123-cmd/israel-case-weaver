// Auto-build the "Contents" string for the back of the box from real case data.
// Lists physical components by type + count (no QR-code mention).
import { supabase } from "@/integrations/supabase/client";

interface DocRow { doc_type: string | null }

interface Counts {
  evidenceDocs: number;
  interrogationScripts: number;
  forensicsReports: number;
  photos: number;
  maps: number;
  suspectDossiers: number;
  envelopes: number;
  other: number;
}

const QR_PATTERN = /\bqr\b|qr[- ]code/i;

function bucket(docType: string | null): keyof Counts {
  const t = (docType ?? "").toLowerCase();
  if (!t) return "other";
  if (/(interrogation|interview|transcript|script)/.test(t)) return "interrogationScripts";
  if (/(forensic|autopsy|ballistic|lab|fingerprint)/.test(t)) return "forensicsReports";
  if (/(photo|polaroid|image|picture)/.test(t)) return "photos";
  if (/(map|floorplan|blueprint|diagram)/.test(t)) return "maps";
  if (/(suspect|profile|dossier|id card|business card)/.test(t)) return "suspectDossiers";
  // evidence-like: report, memo, receipt, form, evidence bag, phone log, note, etc.
  return "evidenceDocs";
}

export async function buildContentsString(projectId: string): Promise<string> {
  const counts: Counts = {
    evidenceDocs: 0, interrogationScripts: 0, forensicsReports: 0,
    photos: 0, maps: 0, suspectDossiers: 0, envelopes: 0, other: 0,
  };

  const [docsRes, envRes, suspectsRes, mediaRes] = await Promise.all([
    supabase.from("documents").select("doc_type").eq("project_id", projectId),
    supabase.from("envelopes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("suspects").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("media_assets").select("category").eq("project_id", projectId).in("category", ["envelope-photo", "scene-photo", "evidence-photo"]),
  ]);

  ((docsRes.data ?? []) as DocRow[]).forEach((d) => {
    counts[bucket(d.doc_type)]++;
  });
  counts.envelopes = envRes.count ?? 0;
  // Add suspects to suspectDossiers count (so 4 suspects → 4 dossiers).
  counts.suspectDossiers += suspectsRes.count ?? 0;
  counts.photos += (mediaRes.data ?? []).length;

  const parts: string[] = [];
  const push = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  push(counts.evidenceDocs, "evidence document", "evidence documents");
  push(counts.interrogationScripts, "interrogation script", "interrogation scripts");
  push(counts.forensicsReports, "forensics report", "forensics reports");
  push(counts.photos, "photo", "photos");
  push(counts.maps, "map", "maps");
  push(counts.suspectDossiers, "suspect dossier", "suspect dossiers");
  push(counts.envelopes, "sealed envelope", "sealed envelopes");

  // Strip any accidental QR mentions (defensive) and join.
  const out = parts.join(" · ").replace(QR_PATTERN, "").replace(/\s+/g, " ").trim();
  return out || "Case files, evidence and props.";
}

// Suspect ↔ Intake-document portrait sync.
//
// When a suspect's active portrait changes (upload, history restore, or fresh
// generation), this helper finds every "Suspect Intake" style document linked
// to that suspect and updates its first inline-image slot to mirror the new
// portrait — pinned as the locked anchor so the rest of the case keeps the
// same visual identity (same lighting, lens, age, wardrobe palette).
//
// "Intake" docs are matched loosely so the assistant can name them in any
// language: title contains "intake" / "suspect" / "תיק חשוד", or doc_type
// starts with "Suspect".
import { supabase } from "@/integrations/supabase/client";

export async function syncSuspectThumbnailToIntakeDocs(opts: {
  projectId: string;
  suspectId: string;
  portraitUrl: string | null;
}): Promise<void> {
  const { projectId, suspectId, portraitUrl } = opts;
  if (!portraitUrl) return;

  // Find docs linked to this suspect.
  const { data: docs, error } = await supabase
    .from("documents")
    .select("id, title, doc_type, linked_suspect_ids")
    .eq("project_id", projectId)
    .contains("linked_suspect_ids", [suspectId]);
  if (error || !docs?.length) return;

  const intakeDocs = docs.filter((d) => {
    const title = (d.title ?? "").toLowerCase();
    const dt = (d.doc_type ?? "").toLowerCase();
    return (
      title.includes("intake") ||
      title.includes("suspect profile") ||
      title.includes("suspect file") ||
      title.includes("תיק") || // Hebrew: file/folder
      dt.startsWith("suspect")
    );
  });
  if (!intakeDocs.length) return;

  for (const d of intakeDocs) {
    // Look at the first inline image slot.
    const { data: slots } = await supabase
      .from("document_inline_images")
      .select("id, url, is_anchor, position")
      .eq("document_id", d.id)
      .order("position", { ascending: true })
      .limit(1);
    const first = slots?.[0];

    if (first) {
      // Skip if it already mirrors this URL (avoid noisy churn).
      if (first.url === portraitUrl && first.is_anchor) continue;
      await supabase
        .from("document_inline_images")
        .update({
          url: portraitUrl,
          is_anchor: true,
          active_version: "generated",
          status: "generated",
        })
        .eq("id", first.id);
    } else {
      // No slot yet — create the anchor slot.
      await supabase.from("document_inline_images").insert({
        document_id: d.id,
        project_id: projectId,
        position: 0,
        slot_label: "Suspect portrait",
        url: portraitUrl,
        is_anchor: true,
        active_version: "generated",
        status: "generated",
      } as never);
    }
  }
}

// Generate visually-consistent images for a SET of documents in one job.
//
// Why this exists:
//   AI image models never produce pixel-identical output from the same text
//   prompt. To make N documents look "the same form" (e.g. 5 interrogation
//   transcripts, 5 police briefings), we generate them as a SET:
//     1. Pull every selected document + every suspect portrait it references.
//     2. Build ONE shared "set brief" that locks layout/paper/header/fonts.
//     3. Call OpenAI gpt-image-2 sequentially per doc, attaching:
//          - All referenced suspect portraits (so the same exact face/photo
//            is used in every doc — pixel-perfect, since we pass the file).
//          - For docs #2..N: the first generated doc image as an extra
//            reference, so layout/style mirrors the first one.
//     4. Save each result to documents.generated_asset_url and stamp the
//        whole group with a shared `consistent_set_id` + `consistent_set_anchor_url`.
//
// Endpoint used: POST https://api.openai.com/v1/images/edits  (multi-image input).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_API_KEY_IMAGE2 = Deno.env.get("OPENAI_IMAGE2_API_KEY") ?? "";

interface Body {
  documentIds: string[];
  setBriefOverride?: string;     // optional extra style notes from user
  quality?: "low" | "medium" | "high";
}

interface DocRow {
  id: string;
  project_id: string;
  title: string;
  doc_type: string | null;
  print_size: string | null;
  design_instructions: string | null;
  hebrew_content: string | null;
  linked_suspect_ids: string[] | null;
  consistent_set_id: string | null;
  consistent_set_anchor_url: string | null;
}

interface SuspectRow {
  id: string;
  name: string;
  thumbnail_url: string | null;
}

async function fetchAsBlob(url: string): Promise<{ blob: Blob; filename: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const mime = r.headers.get("content-type") ?? "image/png";
    const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
    return { blob: new Blob([buf], { type: mime }), filename: `ref-${crypto.randomUUID()}.${ext}` };
  } catch (_) {
    return null;
  }
}

function pickKey(): string {
  return OPENAI_API_KEY_IMAGE2 || OPENAI_API_KEY;
}

function sizeFor(printSize: string | null | undefined): string {
  const ps = (printSize ?? "A4").toLowerCase();
  const portraitSizes = ["a3", "a4", "a5", "a6"];
  if (portraitSizes.includes(ps)) return "1024x1536";
  if (ps === "business card") return "1536x1024";
  return "1024x1536";
}

function buildSetBrief(docs: DocRow[], userOverride: string | undefined): string {
  const types = Array.from(new Set(docs.map((d) => d.doc_type ?? "document").filter(Boolean)));
  return [
    `CONSISTENT-SET RENDER — you are producing one of ${docs.length} document images that MUST share an identical visual template.`,
    `Document type(s) in this set: ${types.join(", ")}.`,
    ``,
    `LOCKED VISUAL PROPERTIES — every image in this set MUST share these exactly:`,
    `- Paper stock, color, grain, texture, edge wear, and aging.`,
    `- Header/letterhead bar (logo placement, agency name, file-number box, classification stamp).`,
    `- Typography: identical fonts, sizes, weights, line spacing, label styles, table styles.`,
    `- Form-field design: same boxes, lines, checkbox styles, signature blocks, footer.`,
    `- Color palette and ink color (same blue/black/red, same stamp colors).`,
    `- Camera/scan look: same angle, same lighting, same shadow, same bleed, same compression artifacts.`,
    `- Page margins, hole-punch positions, staples, paperclip, coffee stains — if present, identical.`,
    ``,
    `VARY ONLY:`,
    `- The body text content per document (provided per-doc below).`,
    `- The specific suspect photo embedded in the form (use the reference image attached for that doc).`,
    `- Per-doc identifiers (case number, date, name field, signature).`,
    ``,
    `Treat the form as a stationery TEMPLATE filled in differently per document — NOT as a fresh design each time.`,
    userOverride?.trim() ? `\nADDITIONAL USER STYLE NOTES:\n${userOverride.trim()}` : "",
  ].filter(Boolean).join("\n");
}

function buildPerDocPrompt(opts: {
  setBrief: string;
  doc: DocRow;
  suspects: SuspectRow[];
  index: number;
  total: number;
  hasAnchor: boolean;
}): string {
  const { setBrief, doc, suspects, index, total, hasAnchor } = opts;
  const text = (doc.hebrew_content ?? "").slice(0, 1200);
  return [
    setBrief,
    ``,
    `THIS IMAGE IS DOCUMENT ${index + 1} OF ${total} IN THE SET.`,
    hasAnchor
      ? `The FIRST attached reference image is the anchor (document #1 already generated). Match its layout, paper, header, typography, and overall look EXACTLY. The remaining attached images are the suspect portraits referenced in this document — embed the correct one inside the form (do NOT regenerate the face; use the supplied photo).`
      : `This is the ANCHOR (first document of the set). Commit to a strong, opinionated visual template — every later document in the set will inherit your layout, paper, header, fonts, and stamp design. The attached images are suspect portraits — embed them inside the form (do NOT regenerate faces).`,
    ``,
    `DOCUMENT TITLE: ${doc.title}`,
    doc.doc_type ? `DOCUMENT TYPE: ${doc.doc_type}` : "",
    doc.design_instructions ? `DESIGN BRIEF: ${doc.design_instructions}` : "",
    suspects.length
      ? `SUSPECTS REFERENCED: ${suspects.map((s) => s.name).join(", ")}`
      : "",
    text ? `BODY CONTENT (render legibly inside the form):\n${text}` : "",
  ].filter(Boolean).join("\n");
}

async function callOpenAiEdit(opts: {
  prompt: string;
  refImages: Array<{ blob: Blob; filename: string }>;
  size: string;
  quality: "low" | "medium" | "high";
}): Promise<{ bytes: Uint8Array; mime: string }> {
  const key = pickKey();
  if (!key) throw new Error("OpenAI API key not configured");
  const fd = new FormData();
  fd.set("model", "gpt-image-2");
  fd.set("prompt", opts.prompt);
  fd.set("size", opts.size);
  fd.set("quality", opts.quality);
  fd.set("n", "1");
  fd.set("output_format", "jpeg");
  fd.set("output_compression", "90");
  // gpt-image-2 supports multiple input images via repeated `image[]`.
  for (const ref of opts.refImages) {
    fd.append("image[]", ref.blob, ref.filename);
  }
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t;
    try { msg = JSON.parse(t)?.error?.message ?? t; } catch { /* */ }
    throw new Error(`OpenAI ${r.status}: ${msg.slice(0, 400)}`);
  }
  const data = await r.json();
  const b64: string | undefined = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned (OpenAI consistent-set)");
  return {
    bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    mime: "image/jpeg",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const documentIds = Array.isArray(body.documentIds) ? body.documentIds.filter((s) => typeof s === "string") : [];
    if (documentIds.length < 2) {
      return new Response(JSON.stringify({ error: "Provide at least 2 documentIds." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (documentIds.length > 8) {
      return new Response(JSON.stringify({ error: "Max 8 documents per consistent set call." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const quality: "low" | "medium" | "high" = body.quality === "high" || body.quality === "low" ? body.quality : "medium";

    const supa = createClient(SUPABASE_URL, SERVICE);

    const { data: docs, error: docsErr } = await supa
      .from("documents")
      .select("id, project_id, title, doc_type, print_size, design_instructions, hebrew_content, linked_suspect_ids, consistent_set_id, consistent_set_anchor_url")
      .in("id", documentIds);
    if (docsErr || !docs || docs.length === 0) {
      return new Response(JSON.stringify({ error: docsErr?.message ?? "Documents not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sortedDocs = (docs as DocRow[]).sort((a, b) => documentIds.indexOf(a.id) - documentIds.indexOf(b.id));
    const projectId = sortedDocs[0].project_id;
    if (!sortedDocs.every((d) => d.project_id === projectId)) {
      return new Response(JSON.stringify({ error: "All documents must belong to the same project." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Suspect lookup
    const allSuspectIds = Array.from(new Set(sortedDocs.flatMap((d) => d.linked_suspect_ids ?? []).filter(Boolean)));
    const suspectsById = new Map<string, SuspectRow>();
    if (allSuspectIds.length) {
      const { data: ss } = await supa
        .from("suspects")
        .select("id, name, thumbnail_url")
        .in("id", allSuspectIds);
      (ss ?? []).forEach((s) => suspectsById.set(s.id, s as SuspectRow));
    }

    // Reuse existing set id if any doc already had one; else mint new.
    const existingSetId = sortedDocs.find((d) => d.consistent_set_id)?.consistent_set_id ?? null;
    const setId = existingSetId ?? crypto.randomUUID();
    let anchorUrl: string | null = sortedDocs.find((d) => d.consistent_set_anchor_url)?.consistent_set_anchor_url ?? null;

    const setBrief = buildSetBrief(sortedDocs, body.setBriefOverride);
    const size = sizeFor(sortedDocs[0].print_size);

    // Mark all docs as generating so the UI shows progress while the
    // background job runs (image generation can take several minutes for
    // a set of 2–8 docs and would otherwise exceed edge wall-clock).
    await supa
      .from("documents")
      .update({ status: "generating", consistent_set_id: setId })
      .in("id", sortedDocs.map((d) => d.id));

    const runJob = async () => {
      let liveAnchor = anchorUrl;
      for (let i = 0; i < sortedDocs.length; i += 1) {
        const doc = sortedDocs[i];
        const suspects = (doc.linked_suspect_ids ?? [])
          .map((sid) => suspectsById.get(sid))
          .filter((x): x is SuspectRow => Boolean(x));

        const refs: Array<{ blob: Blob; filename: string }> = [];
        const hasAnchor = Boolean(liveAnchor);
        if (liveAnchor) {
          const a = await fetchAsBlob(liveAnchor);
          if (a) refs.push(a);
        }
        for (const s of suspects) {
          if (!s.thumbnail_url) continue;
          const b = await fetchAsBlob(s.thumbnail_url);
          if (b) refs.push(b);
        }
        if (refs.length === 0) {
          const blank = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
          refs.push({ blob: new Blob([blank], { type: "image/png" }), filename: "blank.png" });
        }

        const prompt = buildPerDocPrompt({
          setBrief, doc, suspects, index: i, total: sortedDocs.length, hasAnchor,
        });

        try {
          const { bytes, mime } = await callOpenAiEdit({ prompt, refImages: refs, size, quality });
          const path = `${projectId}/consistent-set/${setId}/${doc.id}-${Date.now()}.jpg`;
          await supa.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: true });
          const { data: pub } = supa.storage.from("documents").getPublicUrl(path);
          const url = pub.publicUrl;

          const patch: Record<string, unknown> = {
            generated_asset_url: url,
            active_version: "generated",
            status: "review",
            document_model: "gpt-image-2",
            document_provider: "openai-image2",
            consistent_set_id: setId,
          };
          if (i === 0 && !liveAnchor) {
            patch.consistent_set_anchor_url = url;
            liveAnchor = url;
          } else {
            patch.consistent_set_anchor_url = liveAnchor;
          }
          await supa.from("documents").update(patch).eq("id", doc.id);

          await supa.from("media_assets").insert({
            project_id: projectId,
            category: "document",
            title: `${doc.title} — consistent set`,
            url,
            mime_type: mime,
            prompt,
            provider: "openai-image2",
            model: "gpt-image-2",
            effective_model: "gpt-image-2",
            asset_type: "image",
            source_document_id: doc.id,
            generation_mode: "consistent_set",
            status: "generated",
          } as never);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error(`consistent-set doc ${doc.id} failed:`, msg);
          await supa
            .from("documents")
            .update({ status: "error", consistent_set_id: setId })
            .eq("id", doc.id);
        }
      }
    };

    // Fire-and-forget: don't make the client wait for the whole batch.
    // @ts-ignore EdgeRuntime is available in Supabase edge runtime.
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(runJob());
    } else {
      runJob().catch((e) => console.error("consistent-set job error:", e));
    }

    return new Response(JSON.stringify({
      ok: true,
      queued: true,
      setId,
      documentIds: sortedDocs.map((d) => d.id),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

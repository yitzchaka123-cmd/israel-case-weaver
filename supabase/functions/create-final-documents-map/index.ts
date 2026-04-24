import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type DocumentRow = {
  id: string;
  doc_number: number | null;
  title: string;
  doc_type: string | null;
  print_size: string | null;
  status: string;
  envelope_number: number | null;
  linked_node_ids: string[] | null;
  generated_asset_url: string | null;
  generated_document_url: string | null;
  generated_pdf_url: string | null;
  document_preview_url: string | null;
  created_at: string;
};

type PlannedDoc = {
  docNumber: number;
  title: string;
  docType: string;
  printSize: string;
  envelopeNumber: number | null;
  purpose: string;
  sourceDocumentId?: string;
  generationStatus: string;
};

const NODE_COLOR = "oklch(0.50 0.05 260)";

function asNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function docStatus(doc?: DocumentRow) {
  if (!doc) return "ungenerated";
  if (doc.generated_pdf_url || doc.generated_document_url) return "file generated";
  if (doc.generated_asset_url || doc.document_preview_url) return "image generated";
  return "draft row created";
}

function uniqueLatestDocuments(docs: DocumentRow[]) {
  const sorted = [...docs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const seen = new Set<string>();
  const out: DocumentRow[] = [];
  for (const doc of sorted) {
    const key = doc.doc_number != null ? `n:${doc.doc_number}` : `t:${doc.title.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(doc);
  }
  return out.sort((a, b) => (a.doc_number ?? 9999) - (b.doc_number ?? 9999));
}

function makeDescription(doc: PlannedDoc) {
  return [
    `Status: ${doc.generationStatus === "ungenerated" ? "Ungenerated — to be generated in the future" : doc.generationStatus}`,
    `Type: ${doc.docType}`,
    `Print size: ${doc.printSize}`,
    doc.envelopeNumber ? `Envelope: ${doc.envelopeNumber}` : null,
    doc.sourceDocumentId ? `Linked document row: yes` : `Linked document row: no`,
    `Purpose: ${doc.purpose}`,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, replace = true } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: project, error: projectError } = await supa
      .from("projects")
      .select("id, title, target_doc_count, solution_summary, logic_approved_at")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!project.logic_approved_at || !project.solution_summary) {
      return new Response(JSON.stringify({ error: "Approve the Logic Flow and save a solution summary before creating the Final Documents Map." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: logicNodes }, { data: envelopes }, { data: documents }] = await Promise.all([
      supa.from("canvas_nodes").select("id, title, node_type, description, data").eq("project_id", projectId).eq("board", "logic").order("created_at", { ascending: true }),
      supa.from("envelopes").select("number, label, task, design_instructions").eq("project_id", projectId).order("number", { ascending: true }),
      supa.from("documents").select("id, doc_number, title, doc_type, print_size, status, envelope_number, linked_node_ids, generated_asset_url, generated_document_url, generated_pdf_url, document_preview_url, created_at").eq("project_id", projectId).order("created_at", { ascending: true }),
    ]);

    const existingDocs = uniqueLatestDocuments((documents ?? []) as DocumentRow[]);
    const docsByNumber = new Map<number, DocumentRow>();
    existingDocs.forEach((doc) => {
      if (doc.doc_number != null) docsByNumber.set(doc.doc_number, doc);
    });

    const targetCount = Math.max(1, Math.min(100, asNumber(project.target_doc_count, Math.max(existingDocs.length, 40))));
    const planned: PlannedDoc[] = [];

    const doc0 = docsByNumber.get(0);
    planned.push({
      docNumber: 0,
      title: doc0?.title || "Doc 0 — Contents / Case File Inventory",
      docType: doc0?.doc_type || "contents checklist",
      printSize: doc0?.print_size || "A4",
      envelopeNumber: doc0?.envelope_number ?? null,
      purpose: "Player-facing box contents checklist listing all planned documents and physical pieces, without solution spoilers.",
      sourceDocumentId: doc0?.id,
      generationStatus: docStatus(doc0),
    });

    existingDocs
      .filter((doc) => doc.doc_number !== 0)
      .forEach((doc) => planned.push({
        docNumber: doc.doc_number ?? 100 + planned.length,
        title: doc.title,
        docType: doc.doc_type || "document",
        printSize: doc.print_size || "A4",
        envelopeNumber: doc.envelope_number ?? null,
        purpose: "Existing document row already created for this case.",
        sourceDocumentId: doc.id,
        generationStatus: docStatus(doc),
      }));

    const seeds = [
      ...((envelopes ?? []) as Array<{ number: number; label?: string | null; task?: string | null }>).map((e) => ({
        title: e.label || `Envelope ${e.number} evidence`,
        type: "envelope evidence packet",
        envelopeNumber: e.number,
        purpose: e.task || `Evidence planned for envelope ${e.number}.`,
      })),
      ...((logicNodes ?? []) as Array<{ title: string; node_type: string; description?: string | null }>).map((n) => ({
        title: n.title,
        type: n.node_type === "suspect" ? "suspect file" : n.node_type === "red_herring" ? "red herring evidence" : "case evidence",
        envelopeNumber: null,
        purpose: n.description || `Supports the ${n.node_type.replaceAll("_", " ")} node in the approved logic flow.`,
      })),
    ];

    let nextNumber = Math.max(100, ...planned.map((d) => d.docNumber + 1));
    for (const seed of seeds) {
      if (planned.length >= targetCount) break;
      planned.push({
        docNumber: nextNumber++,
        title: seed.title.length > 90 ? seed.title.slice(0, 87) + "…" : seed.title,
        docType: seed.type,
        printSize: "A4",
        envelopeNumber: seed.envelopeNumber,
        purpose: seed.purpose,
        generationStatus: "ungenerated",
      });
    }

    while (planned.length < targetCount) {
      planned.push({
        docNumber: nextNumber++,
        title: `Planned case document ${planned.length}`,
        docType: "case evidence",
        printSize: "A4",
        envelopeNumber: null,
        purpose: "Reserved slot from the target document count. Define this document before generation.",
        generationStatus: "ungenerated",
      });
    }

    if (replace) {
      await supa.from("canvas_nodes").delete().eq("project_id", projectId).eq("board", "final").eq("node_type", "document");
    }

    const rows = planned.map((doc, i) => ({
      project_id: projectId,
      board: "final",
      node_type: "document",
      title: doc.docNumber === 0 && !/^doc\s*0/i.test(doc.title) ? `Doc 0 — ${doc.title}` : doc.title,
      description: makeDescription(doc),
      color: NODE_COLOR,
      position_x: 80 + (i % 4) * 260,
      position_y: 80 + Math.floor(i / 4) * 170,
      data: {
        generationStatus: doc.generationStatus,
        docNumber: doc.docNumber,
        docType: doc.docType,
        printSize: doc.printSize,
        envelopeNumber: doc.envelopeNumber,
        purpose: doc.purpose,
        documentId: doc.sourceDocumentId ?? null,
      },
    }));

    const { data: inserted, error: insertError } = await supa.from("canvas_nodes").insert(rows).select("id, data");
    if (insertError) throw insertError;

    const updates = (inserted ?? [])
      .map((node: { id: string; data: { documentId?: string | null } }) => ({ nodeId: node.id, documentId: node.data?.documentId }))
      .filter((x) => x.documentId);

    for (const update of updates) {
      const doc = existingDocs.find((d) => d.id === update.documentId);
      const nextLinked = Array.from(new Set([...(doc?.linked_node_ids ?? []), update.nodeId]));
      await supa.from("documents").update({ linked_node_ids: nextLinked }).eq("id", update.documentId);
    }

    return new Response(JSON.stringify({ ok: true, nodeCount: rows.length, linkedCount: updates.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-final-documents-map failed", err);
    const message = err instanceof Error ? err.message : "Failed to create Final Documents Map";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

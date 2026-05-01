import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PLAYBOOK_DEFAULTS, resolvePlaybook } from "../_shared/assistant-playbook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type DbNode = { id: string; title: string; node_type: string; description: string | null; color: string | null; data: Record<string, unknown> | null; position_x: number; position_y: number };
type DbEdge = { source_id: string; target_id: string; label: string | null };
type DocumentRow = { id: string; doc_number: number | null; title: string; doc_type: string | null; print_size: string | null; envelope_number: number | null; linked_node_ids: string[] | null; generated_asset_url: string | null; generated_document_url: string | null; generated_pdf_url: string | null; document_preview_url: string | null; created_at: string };
type EnvelopeRow = { number: number; label: string | null; task: string | null };
type PlannedDoc = {
  docNumber: number;
  title: string;
  docType: string;
  printSize: string;
  envelopeNumber: number | null;
  purpose: string;
  sourceDocumentId?: string;
  sourceLogicNodeIds?: string[];
  linkedLogicTitles?: string[];
  generationStatus: string;
};
type ProposedDoc = {
  doc_number?: number | null;
  title?: string;
  doc_type?: string;
  print_size?: string;
  envelope_number?: number | null;
  purpose?: string;
  linked_logic_node_ids?: string[];
};

const COLORS: Record<string, string> = {
  clue: "oklch(0.68 0.15 155)", suspect: "oklch(0.62 0.20 30)", deduction: "oklch(0.65 0.18 285)", contradiction: "oklch(0.58 0.22 27)", red_herring: "oklch(0.78 0.16 75)", envelope: "oklch(0.55 0.18 220)", document: "oklch(0.50 0.05 260)", solution: "oklch(0.45 0.15 285)", hint: "oklch(0.78 0.16 75)", note: "oklch(0.70 0.02 260)",
};

const n = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const statusFor = (doc?: DocumentRow) => !doc ? "ungenerated" : doc.generated_pdf_url || doc.generated_document_url ? "file generated" : doc.generated_asset_url || doc.document_preview_url ? "image generated" : "draft row created";

function uniqueLatestDocuments(docs: DocumentRow[]) {
  const sorted = [...docs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const seen = new Set<string>();
  return sorted.filter((doc) => {
    const key = doc.doc_number != null ? `n:${doc.doc_number}` : `t:${doc.title.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (a.doc_number ?? 9999) - (b.doc_number ?? 9999));
}

function docDescription(doc: PlannedDoc) {
  return [
    `Status: ${doc.generationStatus === "ungenerated" ? "Ungenerated — to be generated in the future" : doc.generationStatus}`,
    `Type: ${doc.docType}`,
    `Print size: ${doc.printSize}`,
    doc.envelopeNumber ? `Envelope: ${doc.envelopeNumber}` : null,
    doc.sourceDocumentId ? "Linked document row: yes" : "Linked document row: no",
    doc.linkedLogicTitles && doc.linkedLogicTitles.length > 0
      ? `Linked logic nodes: ${doc.linkedLogicTitles.join("; ")}`
      : null,
    `Purpose: ${doc.purpose}`,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { projectId, replace = true, createdByMessageId = null, mode = null } = await req.json();
    if (!projectId) return new Response(JSON.stringify({ error: "projectId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: project } = await supa.from("projects").select("id, owner_id, target_doc_count, solution_summary, logic_approved_at, proposed_document_set, proposed_document_set_status").eq("id", projectId).single();
    if (!project) return new Response(JSON.stringify({ error: "Project not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!project.logic_approved_at || !project.solution_summary) return new Response(JSON.stringify({ error: "Approve the Logic Flow and save a solution summary before creating the Final Flow." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [{ data: logicNodes }, { data: logicEdges }, { data: envelopes }, { data: documents }] = await Promise.all([
      supa.from("canvas_nodes").select("id, title, node_type, description, color, data, position_x, position_y").eq("project_id", projectId).eq("board", "logic").order("created_at", { ascending: true }),
      supa.from("canvas_edges").select("source_id, target_id, label").eq("project_id", projectId).eq("board", "logic"),
      supa.from("envelopes").select("number, label, task").eq("project_id", projectId).order("number", { ascending: true }),
      supa.from("documents").select("id, doc_number, title, doc_type, print_size, envelope_number, linked_node_ids, generated_asset_url, generated_document_url, generated_pdf_url, document_preview_url, created_at").eq("project_id", projectId).order("created_at", { ascending: true }),
    ]);

    const { data: ownerProfile } = project.owner_id
      ? await supa.from("profiles").select("assistant_playbook").eq("id", project.owner_id).maybeSingle()
      : { data: null };
    const playbook = resolvePlaybook((ownerProfile as { assistant_playbook?: unknown } | null)?.assistant_playbook);
    const doc0Def = playbook.universal_documents.docs.find((doc) => doc.key === "doc0_contents") ?? PLAYBOOK_DEFAULTS.universal_documents.docs[0];

    const logic = (logicNodes ?? []) as DbNode[];
    const existingDocs = uniqueLatestDocuments((documents ?? []) as DocumentRow[]);
    const byNumber = new Map<number, DocumentRow>();
    existingDocs.forEach((doc) => { if (doc.doc_number != null) byNumber.set(doc.doc_number, doc); });

    const planned: PlannedDoc[] = [];
    const proposedRaw = Array.isArray(project.proposed_document_set) ? project.proposed_document_set as ProposedDoc[] : [];
    const proposedStatus = String(project.proposed_document_set_status ?? "none");
    // Mode override from the UI:
    //   "from-logic"     → always use the assistant's approved/proposed doc set (fresh plan from logic)
    //   "from-existing"  → always use the existing document rows already created for this case
    //   null (default)   → previous heuristic (proposal if usable, else existing)
    const proposalUsable = proposedRaw.length > 0 && (proposedStatus === "approved" || proposedStatus === "bypassed" || proposedStatus === "proposed");
    let useProposal: boolean;
    if (mode === "from-logic") useProposal = proposalUsable;
    else if (mode === "from-existing") useProposal = false;
    else useProposal = proposalUsable;
    if (mode === "from-logic" && !proposalUsable) {
      return new Response(JSON.stringify({ error: "No approved logic-based document plan found. Ask the assistant to propose the document set first." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const logicById = new Map(logic.map((node) => [node.id, node]));
    const titlesFor = (ids: string[] | undefined) => (ids ?? []).map((id) => logicById.get(id)?.title).filter((t): t is string => typeof t === "string" && t.length > 0);

    const doc0 = byNumber.get(0);
    if (playbook.universal_documents.doc0_enabled && doc0Def.enabled) {
      planned.push({ docNumber: 0, title: doc0?.title || doc0Def.title_template, docType: doc0?.doc_type || doc0Def.doc_type, printSize: doc0?.print_size || doc0Def.print_size, envelopeNumber: doc0?.envelope_number ?? null, purpose: `${doc0Def.purpose} Source of truth: Final Flow document nodes. List scope: ${doc0Def.list_scope}.`, sourceDocumentId: doc0?.id, generationStatus: statusFor(doc0) });
    }

    if (useProposal) {
      // Assistant-led: build the planned document list strictly from the
      // approved proposal. Each entry carries its own purpose + linked logic
      // node IDs reasoned by the assistant — no padding from logic nodes.
      let nextNumber = Math.max(1, ...planned.map((d) => d.docNumber + 1));
      proposedRaw.forEach((p) => {
        const number = (typeof p.doc_number === "number" && Number.isFinite(p.doc_number) && p.doc_number !== 0) ? p.doc_number : nextNumber++;
        if (number === 0) return; // Doc 0 already added via playbook
        const linkedIds = (p.linked_logic_node_ids ?? []).filter((id): id is string => typeof id === "string");
        const existing = existingDocs.find((d) => d.doc_number === number || d.title.trim().toLowerCase() === String(p.title ?? "").trim().toLowerCase());
        planned.push({
          docNumber: number,
          title: String(p.title ?? `Planned document ${number}`).slice(0, 120),
          docType: String(p.doc_type ?? "case evidence"),
          printSize: String(p.print_size ?? "A4"),
          envelopeNumber: typeof p.envelope_number === "number" ? p.envelope_number : null,
          purpose: String(p.purpose ?? "Planned by the assistant from the Logic Flow."),
          sourceLogicNodeIds: linkedIds.length > 0 ? linkedIds : undefined,
          linkedLogicTitles: titlesFor(linkedIds),
          sourceDocumentId: existing?.id,
          generationStatus: statusFor(existing),
        });
      });
    } else {
      // Legacy / no-proposal fallback: keep existing behaviour so older cases
      // approved before the assistant-led workflow continue to produce a map.
      existingDocs.filter((doc) => doc.doc_number !== 0).forEach((doc) => planned.push({ docNumber: doc.doc_number ?? 100 + planned.length, title: doc.title, docType: doc.doc_type || "document", printSize: doc.print_size || "A4", envelopeNumber: doc.envelope_number ?? null, purpose: "Existing document row already created for this case.", sourceDocumentId: doc.id, generationStatus: statusFor(doc) }));

      const targetCount = Math.max(planned.length, Math.min(100, n(project.target_doc_count, 40)));
      let nextNumber = Math.max(100, ...planned.map((d) => d.docNumber + 1));
      // NEW MODEL: documents are NOT distributed by envelope. Plan documents
      // from logic / suspect / clue / red_herring nodes — never from envelopes.
      for (const node of logic) {
        if (planned.length >= targetCount) break;
        if (["solution", "envelope"].includes(node.node_type)) continue;
        planned.push({ docNumber: nextNumber++, title: node.title.length > 90 ? `${node.title.slice(0, 87)}…` : node.title, docType: node.node_type === "suspect" ? "suspect file" : node.node_type === "red_herring" ? "red herring evidence" : "case evidence", printSize: "A4", envelopeNumber: null, purpose: node.description || `Supports the ${node.node_type.replaceAll("_", " ")} node in the approved logic flow.`, sourceLogicNodeIds: [node.id], linkedLogicTitles: [node.title], generationStatus: "ungenerated" });
      }
      while (planned.length < targetCount) planned.push({ docNumber: nextNumber++, title: `Planned case document ${planned.length}`, docType: "case evidence", printSize: "A4", envelopeNumber: null, purpose: "Reserved slot from the target document count. Define before generation.", generationStatus: "ungenerated" });
    }

    if (replace) {
      await supa.from("canvas_edges").delete().eq("project_id", projectId).eq("board", "final");
      await supa.from("canvas_nodes").delete().eq("project_id", projectId).eq("board", "final");
    }

    const logicRows = logic.map((node, i) => ({ project_id: projectId, board: "final", node_type: node.node_type, title: node.title, description: node.description, color: node.color || COLORS[node.node_type] || null, position_x: 60 + (i % 3) * 260, position_y: 70 + Math.floor(i / 3) * 150, data: { ...(node.data ?? {}), sourceLogicNodeId: node.id, finalMapRole: "logic" }, ...(createdByMessageId ? { created_by_message_id: createdByMessageId } : {}) }));
    const docRows = planned.map((doc, i) => ({ project_id: projectId, board: "final", node_type: "document", title: doc.docNumber === 0 && !/^doc\s*0/i.test(doc.title) ? `Doc 0 — ${doc.title}` : doc.title, description: docDescription(doc), color: COLORS.document, position_x: 940 + (i % 3) * 270, position_y: 70 + Math.floor(i / 3) * 155, data: { generationStatus: doc.generationStatus, docNumber: doc.docNumber, docType: doc.docType, printSize: doc.printSize, envelopeNumber: doc.envelopeNumber, purpose: doc.purpose, documentId: doc.sourceDocumentId ?? null, sourceLogicNodeIds: doc.sourceLogicNodeIds ?? [], linkedLogicTitles: doc.linkedLogicTitles ?? [], finalMapRole: "document" }, ...(createdByMessageId ? { created_by_message_id: createdByMessageId } : {}) }));

    const { data: inserted, error: insertError } = await supa.from("canvas_nodes").insert([...logicRows, ...docRows]).select("id, node_type, data");
    if (insertError) throw insertError;
    const sourceToFinal = new Map<string, string>();
    const docNodeByIndex: string[] = [];
    (inserted ?? []).forEach((row: { id: string; node_type: string; data: Record<string, unknown> }) => {
      if (row.data?.sourceLogicNodeId) sourceToFinal.set(String(row.data.sourceLogicNodeId), row.id);
      if (row.node_type === "document") docNodeByIndex.push(row.id);
    });

    const finalEdges: Array<{ project_id: string; board: string; source_id: string; target_id: string; label?: string | null }> = [];
    ((logicEdges ?? []) as DbEdge[]).forEach((edge) => {
      const s = sourceToFinal.get(edge.source_id), t = sourceToFinal.get(edge.target_id);
      if (s && t) finalEdges.push({ project_id: projectId, board: "final", source_id: s, target_id: t, label: edge.label });
    });
    const doc0Index = planned.findIndex((doc) => doc.docNumber === 0);
    const doc0Node = doc0Index >= 0 ? docNodeByIndex[doc0Index] : null;
    planned.forEach((doc, i) => {
      const docNode = docNodeByIndex[i];
      if (!docNode) return;
      const sourceIds = (doc.sourceLogicNodeIds ?? []).map((id) => sourceToFinal.get(id)).filter((x): x is string => Boolean(x));
      sourceIds.forEach((sid) => finalEdges.push({ project_id: projectId, board: "final", source_id: sid, target_id: docNode, label: "becomes document" }));
      // NEW MODEL: documents are NOT inside envelopes — they live in the box
      // from the start. Only draw an "inside envelope" edge if the user has
      // explicitly tucked a doc inside a sealed task envelope (rare).
      if (doc.envelopeNumber) {
        const envLogic = logic.find((node) => node.node_type === "envelope" && Number(node.data?.envelopeNumber) === doc.envelopeNumber);
        const envNode = envLogic ? sourceToFinal.get(envLogic.id) : null;
        if (envNode) finalEdges.push({ project_id: projectId, board: "final", source_id: docNode, target_id: envNode, label: `physical insert in envelope ${doc.envelopeNumber}` });
      }
      if (doc0Node && i > 0) finalEdges.push({ project_id: projectId, board: "final", source_id: doc0Node, target_id: docNode, label: "listed in contents" });
    });
    if (finalEdges.length) await supa.from("canvas_edges").insert(finalEdges);

    for (let i = 0; i < planned.length; i += 1) {
      const doc = planned[i];
      if (!doc.sourceDocumentId) continue;
      const existing = existingDocs.find((d) => d.id === doc.sourceDocumentId);
      const nextLinked = Array.from(new Set([...(existing?.linked_node_ids ?? []), docNodeByIndex[i]]));
      await supa.from("documents").update({ linked_node_ids: nextLinked }).eq("id", doc.sourceDocumentId);
    }

    return new Response(JSON.stringify({ ok: true, nodeCount: logicRows.length + docRows.length, documentNodeCount: docRows.length, edgeCount: finalEdges.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("create-final-documents-map failed", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create Final Flow" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

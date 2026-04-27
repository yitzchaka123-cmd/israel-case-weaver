// Generate document content + optional image. Routes through direct provider
// keys only for document work; no hidden Lovable AI fallback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, providerLabel, generateImage, ImageGenError, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { loadClaudeSkillsForSurface, preferredClaudeDocumentSkill, type ClaudeSkillRow } from "../_shared/claude-skills.ts";
import { PLAYBOOK_DEFAULTS, resolvePlaybook } from "../_shared/assistant-playbook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_API_KEY_IMAGE2 = Deno.env.get("OPENAI_IMAGE2_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// Planning/document text models — see ai-router.ts for prefix routing rules.
const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-2.5-pro",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.4": "openai/gpt-5.4",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "claude-haiku": "anthropic/claude-haiku-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

// Image models. OpenAI's gpt-image-* go to OpenAI directly. Nano Banana
// (Gemini family) goes through the shared generateImage helper, which prefers
// GEMINI_API_KEY direct and falls back to Lovable AI Gateway.
const IMAGE_MODEL: Record<string, string> = {
  "chatgpt-image-2": "gpt-image-2",
  "chatgpt-image": "gpt-image-1",
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
  "nano-banana": "google/gemini-2.5-flash-image",
};

const OPENAI_IMAGE_KEYS = new Set(["chatgpt-image-2", "chatgpt-image"]);

function pickOpenAIImageKey(pref: string): string {
  if (pref === "chatgpt-image-2" && OPENAI_API_KEY_IMAGE2) return OPENAI_API_KEY_IMAGE2;
  return OPENAI_API_KEY;
}

function resolveDocumentModel(project: Record<string, unknown> | null): string {
  const pref = String(project?.ai_provider_documents ?? project?.ai_provider_planning ?? "").trim();
  return PROVIDER_MODEL[pref] ?? "";
}

function directProviderBlock(model: string, output: string): Response | null {
  if (!model || providerLabel(model) === "lovable-ai") {
    return new Response(JSON.stringify({
      error: `No direct ${output} model is selected. Switch Documents to ChatGPT 5.2/OpenAI, Claude, or Gemini Direct in Settings, then retry.`,
    }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return null;
}

function directFileCapabilityBlock(model: string, format: string): Response | null {
  if (model.startsWith("anthropic/")) return null;
  const label = model.startsWith("openai/") ? "ChatGPT 5.2 / OpenAI" : model.startsWith("gemini-direct/") ? "Gemini Direct" : providerLabel(model);
  return new Response(JSON.stringify({
    error: `${label} in this app can write document content, but this route cannot return a downloadable ${format.toUpperCase()} file. Switch Documents to Claude with document skills for PDF/DOCX/PPTX/XLSX, or choose Image-only for a visual preview.`,
  }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const MIME_BY_FORMAT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function findFileIds(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const rec = node as Record<string, unknown>;
    for (const key of ["file_id", "fileId", "id"]) {
      const v = rec[key];
      if (typeof v === "string" && /^file_/.test(v)) found.add(v);
    }
    Object.values(rec).forEach(walk);
  };
  walk(value);
  return [...found];
}

function isDoc0(doc: Record<string, unknown>): boolean {
  const title = String(doc.title ?? "").toLowerCase();
  const type = String(doc.doc_type ?? "").toLowerCase();
  return Number(doc.doc_number) === 0 || /\bdoc\s*0\b|document\s*0|contents|inventory|תוכן עניינים|רשימת תכולה/.test(title) || type === "contents checklist";
}

async function loadDoc0InventoryContext(supa: any, projectId: string) {
  const [{ data: project }, { data: finalDocs }, { data: envelopes }, { data: suspects }, { data: existingDocs }] = await Promise.all([
    supa.from("projects").select("owner_id").eq("id", projectId).single(),
    supa.from("canvas_nodes").select("id, title, description, data, created_at").eq("project_id", projectId).eq("board", "final").eq("node_type", "document").order("position_y", { ascending: true }),
    supa.from("envelopes").select("number, label, task").eq("project_id", projectId).order("number", { ascending: true }),
    supa.from("suspects").select("name, role_in_case").eq("project_id", projectId).order("position", { ascending: true }),
    supa.from("documents").select("id, doc_number, title, doc_type, print_size, envelope_number, status, created_at").eq("project_id", projectId).order("doc_number", { ascending: true, nullsFirst: false }),
  ]);
  const { data: ownerProfile } = project?.owner_id
    ? await supa.from("profiles").select("assistant_playbook").eq("id", project.owner_id).maybeSingle()
    : { data: null };
  const playbook = resolvePlaybook((ownerProfile as { assistant_playbook?: unknown } | null)?.assistant_playbook);
  const doc0Def = playbook.universal_documents.docs.find((doc) => doc.key === "doc0_contents") ?? PLAYBOOK_DEFAULTS.universal_documents.docs[0];

  const docNodes = (finalDocs ?? [])
    .filter((node: any) => Number(node.data?.docNumber) !== 0 && !/^doc\s*0\b/i.test(String(node.title ?? "")))
    .map((node: any) => ({
      docNumber: node.data?.docNumber ?? "?",
      title: node.title ?? "Untitled document",
      docType: node.data?.docType ?? "document",
      printSize: node.data?.printSize ?? "A4",
      envelopeNumber: node.data?.envelopeNumber ?? null,
      purpose: node.data?.purpose ?? node.description ?? "Planned case document.",
      generationStatus: node.data?.generationStatus ?? "planned",
    }));

  return {
    hasFinalMap: docNodes.length > 0,
    doc0: doc0Def,
    text: [
      `DOC 0 PLAYBOOK RULE: ${doc0Def.title_template} (${doc0Def.doc_type}, ${doc0Def.print_size}). Purpose: ${doc0Def.purpose}. List scope: ${doc0Def.list_scope}.`,
      ``,
      `🚨 SPOILER GUARD — ABSOLUTE RULES FOR DOC 0:`,
      `- Doc 0 lists WHAT IS IN THE BOX, nothing else.`,
      `- For every envelope, list ONLY the number and short label (e.g. "מעטפה 2 — מעטפת המשימה"). NEVER print the envelope's task / opening trigger / payload — those are spoilers.`,
      `- Do NOT include any "open after…" / "open when…" / "use this when…" hints next to envelopes. Just number + label, like a contents page on a board game.`,
      `- Do NOT mention the solution, the killer, the twist, the red herring, or any deduction.`,
      ``,
      `FINAL FLOW DOCUMENT NODES (authoritative list for Doc 0):`,
      docNodes.map((d: any) => `- #${d.docNumber} ${d.title} (${d.docType}, ${d.printSize}). Purpose (for your reference only — do NOT print this): ${d.purpose}`).join("\n") || "(none)",
      `\nSEALED ENVELOPES (number + label ONLY — task text below is for your reference, NEVER print it in Doc 0):`,
      (envelopes ?? []).map((e: any) => `- מעטפה ${e.number} — ${e.label ?? `Envelope ${e.number}`}  [REFERENCE ONLY, DO NOT PRINT: ${e.task ?? "(no task)"}]`).join("\n") || "(none)",
      `\nSUSPECTS / CAST INSERTS:`,
      (suspects ?? []).map((s: any) => `- ${s.name}${s.role_in_case ? ` — ${s.role_in_case}` : ""}`).join("\n") || "(none)",
      `\nEXISTING DOCUMENT ROWS (for status only; do not invent missing inventory from these if Final Flow differs):`,
      (existingDocs ?? []).map((d: any) => `- #${d.doc_number ?? "?"} ${d.title} (${d.doc_type ?? "document"}, ${d.print_size ?? "A4"})`).join("\n") || "(none)",
    ].join("\n"),
  };
}

// Build a rich, case-specific context for non-Doc-0 documents. The model must
// reason the document content from the case (Logic Flow, suspects, the
// document's planned purpose) — NOT from generic templates keyed off doc_type.
async function loadPlannedDocContext(supa: any, projectId: string, documentId: string) {
  const [{ data: project }, { data: logicNodes }, { data: logicEdges }, { data: suspects }, { data: envelopes }, { data: finalDocNodes }] = await Promise.all([
    supa.from("projects").select("title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, solution_summary").eq("id", projectId).single(),
    supa.from("canvas_nodes").select("id, title, node_type, description, data").eq("project_id", projectId).eq("board", "logic").order("created_at", { ascending: true }),
    supa.from("canvas_edges").select("source_id, target_id, label").eq("project_id", projectId).eq("board", "logic"),
    supa.from("suspects").select("name, role_in_case, motives, secrets, summary, is_red_herring").eq("project_id", projectId).order("position", { ascending: true }),
    supa.from("envelopes").select("number, label, task").eq("project_id", projectId).order("number", { ascending: true }),
    supa.from("canvas_nodes").select("id, title, description, data").eq("project_id", projectId).eq("board", "final").eq("node_type", "document"),
  ]);

  const finalNode = (finalDocNodes ?? []).find((n: any) => n.data?.documentId === documentId) ?? null;
  const linkedLogicIds: string[] = Array.isArray(finalNode?.data?.sourceLogicNodeIds) ? finalNode.data.sourceLogicNodeIds : [];
  const linkedTitles: string[] = Array.isArray(finalNode?.data?.linkedLogicTitles) ? finalNode.data.linkedLogicTitles : [];
  const purpose: string = String(finalNode?.data?.purpose ?? "");

  const logicById = new Map((logicNodes ?? []).map((n: any) => [n.id, n]));
  const linkedNodes = linkedLogicIds.map((id) => logicById.get(id)).filter(Boolean) as any[];

  const lines: string[] = [];
  lines.push(`CASE BRIEF`);
  lines.push(`- Title: ${project?.title ?? ""}${project?.subtitle ? ` — ${project.subtitle}` : ""}`);
  if (project?.mystery_type || project?.genre) lines.push(`- Mystery type / genre: ${[project?.mystery_type, project?.genre].filter(Boolean).join(" / ")}`);
  if (project?.year) lines.push(`- Year / setting: ${project?.year}${project?.setting ? ` — ${project.setting}` : ""}`);
  if (project?.player_role) lines.push(`- Player role: ${project.player_role}`);
  if (project?.case_goal) lines.push(`- Case goal: ${project.case_goal}`);
  if (project?.selling_point) lines.push(`- Selling point: ${project.selling_point}`);
  lines.push(``);

  if (project?.solution_summary) {
    lines.push(`APPROVED SOLUTION SUMMARY (authoritative — never contradict, never spoil in player-facing text):`);
    lines.push(project.solution_summary);
    lines.push(``);
  }

  if ((suspects ?? []).length > 0) {
    lines.push(`SUSPECTS / CAST:`);
    (suspects ?? []).forEach((s: any) => {
      lines.push(`- ${s.name}${s.role_in_case ? ` — ${s.role_in_case}` : ""}${s.is_red_herring ? " [RED HERRING]" : ""}${s.motives ? ` | motives: ${s.motives}` : ""}${s.secrets ? ` | secrets: ${s.secrets}` : ""}`);
    });
    lines.push(``);
  }

  if ((envelopes ?? []).length > 0) {
    lines.push(`ENVELOPES (delivery containers):`);
    (envelopes ?? []).forEach((e: any) => lines.push(`- Envelope ${e.number}: ${e.label ?? ""}${e.task ? ` — ${e.task}` : ""}`));
    lines.push(``);
  }

  if ((logicNodes ?? []).length > 0) {
    lines.push(`APPROVED LOGIC FLOW NODES (clues → deductions → solution; this is the puzzle chain you must serve):`);
    (logicNodes ?? []).forEach((n: any) => lines.push(`- [${n.node_type}] ${n.title}${n.description ? ` — ${n.description.slice(0, 240)}` : ""}`));
    lines.push(``);
  }

  if ((logicEdges ?? []).length > 0) {
    const titleOf = (id: string) => (logicById.get(id) as any)?.title ?? "?";
    lines.push(`LOGIC FLOW CONNECTIONS:`);
    (logicEdges ?? []).slice(0, 60).forEach((e: any) => lines.push(`- ${titleOf(e.source_id)} → ${titleOf(e.target_id)}${e.label ? ` (${e.label})` : ""}`));
    lines.push(``);
  }

  if (linkedNodes.length > 0 || linkedTitles.length > 0 || purpose) {
    lines.push(`THIS DOCUMENT'S ROLE IN THE CASE (from the Final Flow plan — the assistant reasoned this when planning the document set):`);
    if (purpose) lines.push(`- Purpose / clue this document delivers: ${purpose}`);
    const titles = linkedNodes.length > 0 ? linkedNodes.map((n) => n.title) : linkedTitles;
    if (titles.length > 0) lines.push(`- Logic Flow nodes this document supports: ${titles.join("; ")}`);
    linkedNodes.forEach((n) => {
      if (n.description) lines.push(`  • [${n.node_type}] ${n.title}: ${String(n.description).slice(0, 280)}`);
    });
    lines.push(``);
  }

  return { text: lines.join("\n"), purpose, hasContext: lines.length > 1 };
}

async function recordDocumentAttempt(supa: any, opts: {
  projectId: string;
  documentId: string;
  createdByMessageId?: string | null;
  title: string;
  documentFormat: string;
  prompt: string;
  provider: string;
  model: string;
  effectiveModel?: string;
  status: "generated" | "failed";
  errorMessage?: string;
  url?: string;
  mime?: string;
  skill?: ClaudeSkillRow | null;
}) {
  await supa.from("media_assets").insert({
    project_id: opts.projectId,
    category: "document",
    title: opts.title,
    url: opts.url ?? null,
    mime_type: opts.mime ?? MIME_BY_FORMAT[opts.documentFormat] ?? null,
    prompt: opts.prompt,
    provider: opts.provider,
    model: opts.model,
    effective_model: opts.effectiveModel ?? opts.model,
    asset_type: "document",
    document_format: opts.documentFormat,
    skill_id: opts.skill?.skill_id ?? null,
    skill_source: opts.skill ? (opts.skill.skill_type === "anthropic" ? "anthropic" : "custom") : "none",
    skill_name: opts.skill?.name ?? null,
    source_document_id: opts.documentId,
    created_by_message_id: opts.createdByMessageId ?? null,
    generation_mode: opts.skill ? "direct_model_file_claude_skill" : "direct_model_file",
    status: opts.status,
    error_message: opts.errorMessage ?? null,
  } as never);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentId, mode, imageModelOverride, quality: qualityOverride, documentFormat = "pdf" } = await req.json() as { documentId: string; mode: "text" | "image" | "document" | "image_to_pdf"; imageModelOverride?: string; quality?: "low" | "medium" | "high"; documentFormat?: "pdf" | "docx" | "pptx" | "xlsx" };
    if (!documentId || !mode) {
      return new Response(JSON.stringify({ error: "documentId and mode required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: doc, error } = await supa.from("documents").select("*").eq("id", documentId).single();
    if (error || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: project } = await supa.from("projects").select("*").eq("id", doc.project_id).single();
    const gameLanguage = String(project?.game_language ?? "Hebrew").trim() || "Hebrew";
    const isRtl = ["Hebrew", "Arabic", "Persian", "Urdu", "Yiddish"].includes(gameLanguage);

    // Mirror the document's lifecycle status onto its linked Final Flow node(s)
    // by merging into existing node.data so we don't wipe docNumber/docType/etc.
    // The CaseNode renderer reads data.generationStatus to color the pill:
    //   "generated" → blue, "approved" → green.
    const mirrorStatusOnNodes = async (generationStatus: "generated" | "approved") => {
      try {
        const linked: string[] = Array.isArray(doc.linked_node_ids) ? doc.linked_node_ids : [];
        const { data: nodes } = await supa
          .from("canvas_nodes")
          .select("id, data")
          .eq("project_id", doc.project_id)
          .eq("board", "final")
          .eq("node_type", "document");
        const targets = (nodes ?? []).filter((n: any) =>
          (n.data as { documentId?: string } | null)?.documentId === documentId ||
          linked.includes(n.id)
        );
        for (const n of targets) {
          const merged = { ...((n.data as Record<string, unknown> | null) ?? {}), generationStatus };
          await supa.from("canvas_nodes").update({ data: merged }).eq("id", n.id);
        }
      } catch (e) {
        console.warn("[generate-document] mirrorStatusOnNodes failed", (e as Error).message);
      }
    };

    if (mode === "text") {
      const model = resolveDocumentModel(project);
      const blocked = directProviderBlock(model, "document text");
      if (blocked) return blocked;
      const doc0 = isDoc0(doc);
      const inventory = doc0 ? await loadDoc0InventoryContext(supa, doc.project_id) : null;
      if (doc0 && !inventory?.hasFinalMap) {
        return new Response(JSON.stringify({ error: "Doc 0 must be generated from the Final Flow. Create the Final Documents Map first, then retry Doc 0." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const planned = doc0 ? null : await loadPlannedDocContext(supa, doc.project_id, documentId);
      const sys = doc0
        ? `You write Doc 0: a plain, player-facing box-contents inventory for a printable mystery game. Doc 0 is NOT in-world evidence. It is NOT a case memo. It is NOT styled like an aged document. Treat it as a clean printer-paper checklist.\n\n🚨 SPOILER GUARD (HARD RULE): For sealed envelopes, list ONLY their number and short label (e.g. "מעטפה 2 — מעטפת המשימה"). NEVER print the envelope's task, opening trigger, instruction, or any "open after…" hint — those are spoilers and players will read them too early.\n\nOUTPUT: ONLY a numbered list of every game document, one per line, in ${gameLanguage}, ${isRtl ? "RTL-ready" : "properly formatted"}. NUMBERING STARTS AT 1 (one) — never 0. Do NOT include "Doc 0" / "Document 0" / the inventory sheet itself in the numbered list (it can appear once as a small header line above the list, or be omitted entirely). Format each list line as exactly "<number>. <title>" — nothing else. After the documents, you MAY add a short "מעטפות אטומות" (Sealed envelopes) sub-list with envelope numbers + labels ONLY (no tasks, no triggers). No introduction, no headers beyond a single short title line, no descriptions, no flavor text, no realism details, no solution hints, no commentary about what each document does. Use the supplied Final Flow document nodes as the authoritative inventory. Do not invent documents that are not in the Final Flow. The whole inventory MUST fit on a single sheet at the document's print size — keep titles short and the line count tight.`
        : `You are a senior mystery-game writer producing one in-world evidence document for a premium printable detective game.

CONTENT IS REASONED, NOT TEMPLATED. Read the case brief, the approved solution summary, the suspects, and the Logic Flow nodes this specific document is meant to support. Then write the document so it delivers ITS planned clue / role inside the case — not a generic example of its document type. The 'document type' field is ONLY a hint about FORMAT and visual style (interrogation transcript, autopsy report, letter, receipt, photograph caption, etc.). It is NOT a template for the body. Two documents of the same type in the same case must read very differently because the underlying evidence and characters are different.

OUTPUT RULES:
- Output ONLY the document body in ${gameLanguage}, ${isRtl ? "RTL-ready" : "properly formatted"}.
- No meta-commentary, no disclaimers, no "[Note: ...]".
- Stay in-world. Names, dates, locations, and details must be consistent with the case brief and Logic Flow.
- Honor the document's planned purpose: the clue or piece of information it is supposed to surface for the player.
- Do NOT reveal the full solution. Plant evidence; let the player deduce.
- For interrogation transcripts: include pauses, body language, hesitations, contradictions, real back-and-forth.
- Length and tone should match a real-world example of this document type, but the substance must come from THIS case.`;
      const userPrompt = doc0
        ? `Game: ${project?.title ?? ""}\nGame language: ${gameLanguage}\nDocument to produce: Doc 0 — contents inventory (plain white printer paper).\nPrint size: ${doc.print_size ?? "A4"}\n\n${inventory?.text ?? ""}\n\nProduce ONLY a clean numbered list of every game document and physical insert, one per line, formatted as "<number>. <title>". NUMBER FROM 1 (do NOT start at 0, do NOT include the Doc 0 inventory sheet itself in the list). Keep every title short so the entire list fits on one ${doc.print_size ?? "A4"} sheet. No descriptions, no spoilers, no flavor, no envelope groupings, no realism styling.`
        : `${planned?.text ?? ""}\n\nDOCUMENT TO PRODUCE:\n- Title: ${doc.title}\n- Format style hint (NOT a content template): ${doc.doc_type ?? "evidence document"}\n- Print size: ${doc.print_size ?? "A4"}\n- Design / layout notes: ${doc.design_instructions ?? "—"}\n${planned?.purpose ? `- Planned clue / role: ${planned.purpose}\n` : ""}\nWrite the full ${gameLanguage} body now. Reason from the case brief and Logic Flow above — do NOT fall back on a generic '${doc.doc_type ?? "document"}' template. Make sure the content this document delivers is the planned clue / role for THIS case.`;

      const startedAt = Date.now();
      const callerUserId = await getUserIdFromAuth(req);
      const resp = await chatCompletions({
        model,
        disableFallback: true,
        messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
      });
      const fb = extractFallback(resp, model);

      if (!resp.ok) {
        const provider = model.startsWith("openai/") ? "OpenAI"
          : model.startsWith("anthropic/") ? "Anthropic"
          : model.startsWith("gemini-direct/") ? "Google Gemini"
          : "Lovable AI";
        const t = await resp.text().catch(() => "");
        console.error(`${provider} text error`, resp.status, t);
        await logAiRun({
          userId: callerUserId, projectId: doc.project_id, surface: "generate-document",
          requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
          status: "error", latencyMs: Date.now() - startedAt,
          errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`,
          targetId: documentId, promptExcerpt: userPrompt,
        });
        if (resp.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 402) return new Response(JSON.stringify({ error: `${provider} credits/key issue` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 401) return new Response(JSON.stringify({ error: `${provider} auth failed — check Settings → API keys` }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: `${provider} error (${resp.status})` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await resp.json();
      const bodyText = data.choices?.[0]?.message?.content ?? "";

      await supa.from("documents").update({ hebrew_content: bodyText, status: "review" }).eq("id", documentId);
      await mirrorStatusOnNodes("generated");
      await supa.from("prompts").insert({
        project_id: doc.project_id,
        scope: "document",
        target_id: documentId,
        original_prompt: userPrompt,
        final_prompt: userPrompt,
        provider: providerLabel(model),
        model,
      });

      await logAiRun({
        userId: callerUserId, projectId: doc.project_id, surface: "generate-document",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "ok", latencyMs: Date.now() - startedAt,
        targetId: documentId, promptExcerpt: userPrompt,
      });
      return new Response(JSON.stringify({ ok: true, hebrew_content: bodyText, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "document") {
      const model = resolveDocumentModel(project);
      const blocked = directProviderBlock(model, documentFormat.toUpperCase());
      if (blocked) return blocked;
      const capabilityBlocked = directFileCapabilityBlock(model, documentFormat);
      if (capabilityBlocked) return capabilityBlocked;
      const provider = providerLabel(model);
      const doc0 = isDoc0(doc);
      const inventory = doc0 ? await loadDoc0InventoryContext(supa, doc.project_id) : null;
      if (doc0 && !inventory?.hasFinalMap) {
        return new Response(JSON.stringify({ error: "Doc 0 file must be generated from the Final Flow. Create the Final Documents Map first, then retry Doc 0." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const plannedFile = doc0 ? null : await loadPlannedDocContext(supa, doc.project_id, documentId);
      const { data: inlineImages } = await supa
        .from("document_inline_images")
        .select("position, slot_label, url, uploaded_url, active_version, prompt")
        .eq("document_id", documentId)
        .order("position", { ascending: true });
      const usableInlineImages = (inlineImages ?? [])
        .map((img) => ({
          label: img.slot_label,
          prompt: img.prompt ?? "",
          url: img.active_version === "uploaded" ? (img.uploaded_url ?? img.url) : (img.url ?? img.uploaded_url),
        }))
        .filter((img) => !!img.url);
      const inlineLayout = doc.inline_images_layout ?? "bottom-grid-2col";
      const inlineCaption = (doc.inline_images_caption ?? "").trim();
      const inlineImagesBlock = usableInlineImages.length > 0
        ? `\n\nEMBEDDED IMAGES (must appear inside the rendered document):\nLayout: ${inlineLayout}${inlineCaption ? `\nSection caption: ${inlineCaption}` : ""}\n${usableInlineImages.map((img, i) => `${i + 1}. ${img.label} — ${img.prompt}\n   URL: ${img.url}`).join("\n")}\nPlace these images according to the layout hint (e.g. a 2-column grid at the bottom for "bottom-grid-2col"). Use each image URL as a real <img> / image embed, not a placeholder. Keep aspect ratios; add the slot label as a small caption beneath each image.`
        : "";
      const directFilePrompt = doc0
        ? `Create the final ${documentFormat.toUpperCase()} directly if your API supports returning generated files. If you cannot return an actual file, say exactly: UNABLE_TO_CREATE_FILE.\n\nThis is Doc 0: a plain white printer-paper inventory sheet for a printable mystery game. NOT in-world evidence. NOT a styled prop. Use a clean modern layout: white background, simple sans-serif body, one short title line at the top, then a numbered list — one document per line, "<number>. <title>". NUMBER FROM 1 (do NOT start at 0; do NOT include the Doc 0 inventory itself in the numbered list). No paper aging, no fold lines, no stamps, no coffee rings, no period typography, no signatures, no classification marks, no realism details of any kind. No descriptions or flavor next to each item.\n\nFIT-ON-ONE-PAGE RULE (HARD): The entire numbered list MUST fit on a single ${doc.print_size ?? inventory?.doc0?.print_size ?? "A4"} page. Auto-fit the body font down to roughly 9–11 pt and tighten line-height as needed. If the list has MORE THAN ~20 entries, render it in TWO COLUMNS side-by-side (continuous numbering across columns: column A finishes 1..N, column B continues N+1..). If it has 20 or fewer entries, one column is fine. Never let the list spill onto a second page.\n\nGame: ${project?.title ?? ""}\nLanguage: ${gameLanguage}\nDocument title: ${doc.title}\nPrint size: ${doc.print_size ?? inventory?.doc0?.print_size ?? "A4"}\n\nPlayer-facing content to lay out:\n${doc.hebrew_content ?? ""}`
        : `Create the final ${documentFormat.toUpperCase()} document directly if your API supports returning generated files. If you cannot return an actual file, say exactly: UNABLE_TO_CREATE_FILE.\n\nThe document type is ONLY a visual / format hint (interrogation transcript, autopsy report, letter, etc.) — NOT a content template. The body content below was reasoned from the case's Logic Flow and is the source of truth. Lay it out faithfully in the chosen format.\n\nCase: ${project?.title ?? ""}\nGame language: ${gameLanguage}\nDocument title: ${doc.title}\nFormat style hint: ${doc.doc_type ?? "evidence document"}\nPrint size: ${doc.print_size ?? "A4"}\nDesign notes: ${doc.design_instructions ?? "—"}\n${plannedFile?.purpose ? `Planned clue / role this document delivers: ${plannedFile.purpose}\n` : ""}Content:\n${doc.hebrew_content ?? ""}${inlineImagesBlock}`;
      const startedAt = Date.now();
      const callerUserId = await getUserIdFromAuth(req);
      const saveDocumentPrompt = async (status: "ok" | "error", errorMessage?: string) => {
        await supa.from("prompts").insert({
          project_id: doc.project_id,
          scope: "document_file",
          target_id: documentId,
          original_prompt: directFilePrompt,
          final_prompt: directFilePrompt,
          provider,
          model,
        });
        if (errorMessage) console.warn("document file generation prompt saved after failure", status, errorMessage.slice(0, 120));
      };

      if (model.startsWith("anthropic/")) {
        if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Anthropic API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const enabledSkills = await loadClaudeSkillsForSurface(supa, "documents");
        const skillUsed = preferredClaudeDocumentSkill(enabledSkills, documentFormat);
        const skillPayload = [{ type: skillUsed.skill_type === "anthropic" ? "anthropic" : "custom", skill_id: skillUsed.skill_id, version: skillUsed.version || "latest" }];
        const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "code-execution-2025-05-22,files-api-2025-04-14,skills-2025-10-02",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: model.slice("anthropic/".length),
            max_tokens: 8192,
            tools: [{ type: "code_execution_20250522", name: "code_execution" }],
            container: { skills: skillPayload },
            messages: [{ role: "user", content: directFilePrompt }],
          }),
        });
        const anthropicData = await anthropicResp.json().catch(() => ({}));
        if (!anthropicResp.ok) {
          const err = JSON.stringify(anthropicData).slice(0, 500);
          await saveDocumentPrompt("error", err);
          await recordDocumentAttempt(supa, { projectId: doc.project_id, documentId, createdByMessageId: doc.created_by_message_id, title: doc.title, documentFormat, prompt: directFilePrompt, provider: "anthropic-direct", model, status: "failed", errorMessage: err, skill: skillUsed });
          await logAiRun({ userId: callerUserId, projectId: doc.project_id, surface: "generate-document-file", requestedModel: model, effectiveModel: model, fallback: "none", status: "error", latencyMs: Date.now() - startedAt, errorMessage: err.slice(0, 200), targetId: documentId, promptExcerpt: directFilePrompt });
          return new Response(JSON.stringify({ error: `Claude could not create the ${documentFormat.toUpperCase()} (${anthropicResp.status})` }), { status: anthropicResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const fileId = findFileIds(anthropicData)[0];
        if (fileId) {
          const fileResp = await fetch(`https://api.anthropic.com/v1/files/${fileId}/content`, { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14" } });
          if (fileResp.ok) {
            const bytes = new Uint8Array(await fileResp.arrayBuffer());
            const mime = fileResp.headers.get("content-type") ?? MIME_BY_FORMAT[documentFormat] ?? "application/octet-stream";
            const path = `${doc.project_id}/${documentId}-${Date.now()}.${documentFormat}`;
            await supa.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: true });
            const { data: pub } = supa.storage.from("documents").getPublicUrl(path);
            await supa.from("documents").update({ generated_document_url: pub.publicUrl, generated_pdf_url: documentFormat === "pdf" ? pub.publicUrl : doc.generated_pdf_url, document_format: documentFormat, document_provider: "anthropic-direct", document_model: model, document_skill_id: skillUsed.skill_id, status: "review" }).eq("id", documentId);
            await mirrorStatusOnNodes("generated");
            await recordDocumentAttempt(supa, { projectId: doc.project_id, documentId, createdByMessageId: doc.created_by_message_id, title: doc.title, documentFormat, prompt: directFilePrompt, provider: "anthropic-direct", model, status: "generated", url: pub.publicUrl, mime, skill: skillUsed });
            await saveDocumentPrompt("ok");
            await logAiRun({ userId: callerUserId, projectId: doc.project_id, surface: "generate-document-file", requestedModel: model, effectiveModel: model, fallback: "none", status: "ok", latencyMs: Date.now() - startedAt, targetId: documentId, promptExcerpt: directFilePrompt });
            return new Response(JSON.stringify({ ok: true, documentUrl: pub.publicUrl, documentFormat, model, skillId: (skillPayload[0] as Record<string, unknown>).skill_id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
        await saveDocumentPrompt("error", "Claude did not return a downloadable file");
        await recordDocumentAttempt(supa, { projectId: doc.project_id, documentId, createdByMessageId: doc.created_by_message_id, title: doc.title, documentFormat, prompt: directFilePrompt, provider: "anthropic-direct", model, status: "failed", errorMessage: "Claude did not return a downloadable file", skill: skillUsed });
        await logAiRun({ userId: callerUserId, projectId: doc.project_id, surface: "generate-document-file", requestedModel: model, effectiveModel: model, fallback: "none", status: "error", latencyMs: Date.now() - startedAt, errorMessage: "Claude did not return a downloadable file", targetId: documentId, promptExcerpt: directFilePrompt });
        return new Response(JSON.stringify({ error: `Claude was not able to create a downloadable ${documentFormat.toUpperCase()} directly.` }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const resp = await chatCompletions({ model, disableFallback: true, messages: [{ role: "user", content: directFilePrompt }] });
      const fb = extractFallback(resp, model);
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        await saveDocumentPrompt("error", t);
        await recordDocumentAttempt(supa, { projectId: doc.project_id, documentId, createdByMessageId: doc.created_by_message_id, title: doc.title, documentFormat, prompt: directFilePrompt, provider, model, effectiveModel: fb.effectiveModel, status: "failed", errorMessage: t.slice(0, 500), skill: null });
        await logAiRun({ userId: callerUserId, projectId: doc.project_id, surface: "generate-document-file", requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback, status: "error", latencyMs: Date.now() - startedAt, errorMessage: t.slice(0, 200), targetId: documentId, promptExcerpt: directFilePrompt });
        return new Response(JSON.stringify({ error: `${provider} could not create the ${documentFormat.toUpperCase()} (${resp.status})` }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await resp.json();
      const content = String(data.choices?.[0]?.message?.content ?? "").trim();
      await saveDocumentPrompt("error", "Model did not return a downloadable file");
      await recordDocumentAttempt(supa, { projectId: doc.project_id, documentId, createdByMessageId: doc.created_by_message_id, title: doc.title, documentFormat, prompt: directFilePrompt, provider, model, effectiveModel: fb.effectiveModel, status: "failed", errorMessage: "Model did not return a downloadable file", skill: null });
      await logAiRun({ userId: callerUserId, projectId: doc.project_id, surface: "generate-document-file", requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback, status: "error", latencyMs: Date.now() - startedAt, errorMessage: "Model did not return a downloadable file", targetId: documentId, promptExcerpt: directFilePrompt });
      return new Response(JSON.stringify({ error: content.includes("UNABLE_TO_CREATE_FILE") ? `${provider} was not able to create a downloadable ${documentFormat.toUpperCase()} directly.` : `${provider} responded, but did not return a downloadable ${documentFormat.toUpperCase()} file.` }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === "image") {
      const imgPref = (imageModelOverride as string) || (project?.ai_provider_images as string) || "chatgpt-image-2";
      const model = IMAGE_MODEL[imgPref] ?? IMAGE_MODEL["chatgpt-image-2"];
      const useOpenAI = OPENAI_IMAGE_KEYS.has(imgPref);

      const designNotes = (doc.design_instructions ?? "").trim();
      const doc0 = isDoc0(doc);
      const inventory = doc0 ? await loadDoc0InventoryContext(supa, doc.project_id) : null;
      if (doc0 && !inventory?.hasFinalMap) {
        return new Response(JSON.stringify({ error: "Doc 0 image must be generated from the Final Flow. Create the Final Documents Map first, then retry Doc 0." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const contentExcerpt = (doc.hebrew_content ?? "").trim().slice(0, doc0 ? 2400 : 1200);
      const userImageInstructions = (project?.image_prompt_instructions as string ?? "").trim();

      const imgPrompt = doc0
        ? [
            userImageInstructions
              ? `USER GLOBAL IMAGE INSTRUCTIONS (apply to every image in this project — highest priority):\n${userImageInstructions}\n`
              : "",
            `Create a single high-resolution image of Doc 0: a plain white printer-paper inventory sheet for a printable mystery game. Doc 0 is NOT in-world evidence and NOT a styled prop.`,
            `Game: "${project?.title ?? ""}". Language: ${gameLanguage}, ${isRtl ? "RTL" : "LTR"}.`,
            `Final print size: ${doc.print_size ?? "A4"} — compose to that aspect ratio with generous safe margins.`,
            ``,
            `STYLE — STRICT:`,
            `- Plain white background. Clean modern sans-serif typography. Crisp digital print look, like a freshly printed page.`,
            `- ABSOLUTELY NO realism details: no paper aging, no yellowing, no fold lines, no edge wear, no punch holes, no stamps, no signatures, no classification marks, no coffee/ink rings, no smudges, no staples or paperclips, no period typewriter look, no carbon-copy bleed, no tape, no fingerprints, no perforation, no dog-eared corners. None.`,
            `- No props, no desk surface, no shadows, no photographic framing — render as the page itself, edge to edge, fill the frame.`,
            ``,
            `LAYOUT — FIT ON ONE PAGE (HARD):`,
            `- One short title line at the top (e.g. the document title).`,
            `- Below it: a numbered list, one document per line, formatted "<number>. <title>". NUMBER FROM 1 (do NOT start at 0; do NOT include the Doc 0 inventory sheet itself in the numbered list).`,
            `- The entire numbered list MUST fit on this single sheet. If there are MORE THAN ~20 entries, render the list in TWO COLUMNS side-by-side, with continuous numbering across columns (column A: 1..N, column B: N+1..). 20 or fewer entries: one column. Auto-fit the body font down to roughly 9–11 pt and tighten line-height as needed so nothing overflows.`,
            `- One item per line. No descriptions, no flavor text, no commentary, no envelope groupings, no spoilers.`,
            ``,
            `CONTENT TO RENDER (${gameLanguage}, ${isRtl ? "RTL" : "LTR"}, fully legible):`,
            contentExcerpt ? contentExcerpt : `Render this inventory as the numbered list:\n${inventory?.text ?? ""}`,
            ``,
            `RULES:`,
            `- All visible text in ${gameLanguage}.`,
            `- No English placeholder text. No watermarks. No logos. No real emblems.`,
            `- Output ONE image only.`,
          ].filter(Boolean).join("\n")
        : [
            userImageInstructions
              ? `USER GLOBAL IMAGE INSTRUCTIONS (apply to every image in this project — highest priority):\n${userImageInstructions}\n`
              : "",
            `Create a single high-resolution, photorealistic, print-ready image of a ${doc.doc_type ?? "document"} for a premium mystery / detective game.`,
            `Game title: "${project?.title ?? ""}"${project?.subtitle ? ` — ${project.subtitle}` : ""}.`,
            `Era / setting: ${project?.year ?? "—"}, ${project?.setting ?? "Israeli setting"}.`,
            `Genre: ${project?.genre ?? "mystery"}. Mystery type: ${project?.mystery_type ?? "—"}.`,
            `Document title (visible if appropriate): "${doc.title}".`,
            `Final print size: ${doc.print_size ?? "A4"} — compose to that aspect ratio with safe margins.`,
            ``,
            `STRICT DESIGN & GRAPHIC INSTRUCTIONS (FOLLOW EVERY DETAIL — this is the primary brief):`,
            designNotes ? designNotes : `Authentic, period-correct, high-detail. Treat as a real-world physical prop: realistic paper texture, period-correct typography, believable headers/stamps/signatures.`,
            ``,
            `CONTENT TO RENDER (${gameLanguage}, ${isRtl ? "RTL" : "LTR"}, grammatically correct, fully legible):`,
            contentExcerpt ? contentExcerpt : `Use plausible ${gameLanguage} text appropriate to the document type. All ${gameLanguage} must be perfectly readable and correctly laid out ${isRtl ? "right-to-left" : "left-to-right"}.`,
            ``,
            `RULES:`,
            `- Render as a real-world physical document photographed or scanned, not a UI mockup.`,
            `- All visible player-facing text must be in ${gameLanguage} unless the document type explicitly calls for another language.`,
            `- Do NOT include English placeholder text like "Lorem ipsum".`,
            `- Do NOT add modern watermarks, logos of real companies, or AI-generated artifacts.`,
            `- High dynamic range, sharp focus on the document, neutral lighting, color-accurate.`,
            `- Output ONE image only. Fill the frame with the document.`,
          ].filter(Boolean).join("\n");

      const imageProvider = useOpenAI ? (imgPref === "chatgpt-image-2" ? "openai-image2" : "openai") : (Deno.env.get("GEMINI_API_KEY") ? "gemini-direct" : "lovable-ai");
      const requestedQuality = (qualityOverride === "high" || qualityOverride === "low" || qualityOverride === "medium") ? qualityOverride : "medium";

      // ─── Determine OpenAI sizing once (shared by sync + async path) ───
      const ps = (doc.print_size ?? "A4").toLowerCase();
      const portraitSizes = ["a3", "a4", "a5", "a6"];
      const isGptImage2 = model === "gpt-image-2";
      const openAiSize = isGptImage2
        ? (portraitSizes.includes(ps) ? "1440x2048" : ps === "business card" ? "2048x1440" : "1440x2048")
        : (portraitSizes.includes(ps) ? "1024x1536" : ps === "business card" ? "1536x1024" : "1024x1536");

      // Helper that does the OpenAI call → upload → DB writes. Used by both
      // the synchronous path (medium/low) and the async background path (high).
      const runOpenAiImage = async (opts: { jobId?: string; abortMs?: number; quality: "low" | "medium" | "high" }) => {
        const openAiImageKey = pickOpenAIImageKey(imgPref);
        if (!openAiImageKey) throw new Error("OpenAI API key not configured");
        const openaiBody: Record<string, unknown> = {
          model, prompt: imgPrompt, size: openAiSize, quality: opts.quality, n: 1,
          output_format: "jpeg", output_compression: 90,
        };
        if (isGptImage2) openaiBody.moderation = "low";
        const controller = opts.abortMs ? new AbortController() : undefined;
        const timer = opts.abortMs && controller ? setTimeout(() => controller.abort(), opts.abortMs) : undefined;
        const oResp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${openAiImageKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(openaiBody),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (timer) clearTimeout(timer);
        if (!oResp.ok) {
          const t = await oResp.text();
          let realMessage = t;
          try { realMessage = JSON.parse(t)?.error?.message ?? t; } catch { /* not json */ }
          throw new Error(`OpenAI ${oResp.status}: ${realMessage}`);
        }
        const oData = await oResp.json();
        const b64: string | undefined = oData.data?.[0]?.b64_json;
        if (!b64) throw new Error("No image returned (OpenAI)");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const mime = "image/jpeg";
        const ext = "jpg";
        const path = `${doc.project_id}/${documentId}-${Date.now()}.${ext}`;
        await supa.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: true });
        const { data: pub } = supa.storage.from("documents").getPublicUrl(path);
        await supa.from("documents").update({ generated_asset_url: pub.publicUrl, active_version: "generated", status: "review", document_model: model, document_provider: imageProvider }).eq("id", documentId);
        await mirrorStatusOnNodes("generated");
        await supa.from("media_assets").insert({
          project_id: doc.project_id, category: "document", title: doc.title, url: pub.publicUrl,
          mime_type: mime, prompt: imgPrompt, provider: imageProvider, model, effective_model: model,
          asset_type: "image", document_format: "image", source_document_id: documentId,
          created_by_message_id: doc.created_by_message_id ?? null, generation_mode: "image_generation",
          status: "generated", error_message: null,
        } as never);
        if (opts.jobId) {
          await supa.from("image_generations").update({
            status: "generated", url: pub.publicUrl, mime_type: mime, effective_model: model, fallback: "none",
          }).eq("id", opts.jobId);
        }
        return pub.publicUrl;
      };

      // ── Async background path: gpt-image-2 at HIGH quality ──
      // Insert a pending job and respond immediately. Continue the OpenAI
      // call in the background via EdgeRuntime.waitUntil so the platform
      // doesn't kill us at 110s.
      if (useOpenAI && requestedQuality === "high") {
        const { data: jobRow, error: jobErr } = await supa.from("image_generations").insert({
          project_id: doc.project_id, source_document_id: documentId, prompt: imgPrompt,
          model, provider: imageProvider, quality: "high", status: "pending",
          created_by_message_id: doc.created_by_message_id ?? null,
        } as never).select("id").single();
        if (jobErr || !jobRow) {
          return new Response(JSON.stringify({ error: `Could not start background job: ${jobErr?.message ?? "unknown"}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const jobId = (jobRow as { id: string }).id;
        await supa.from("prompts").insert({
          project_id: doc.project_id, scope: "document-image", target_id: documentId,
          original_prompt: imgPrompt, final_prompt: imgPrompt, provider: imageProvider, model,
        });

        const bg = (async () => {
          try {
            await runOpenAiImage({ jobId, quality: "high" });
          } catch (e) {
            console.error("background gpt-image-2 high failed", e);
            await supa.from("image_generations").update({
              status: "failed", error_message: (e as Error)?.message?.slice(0, 1000) ?? "Unknown error",
            }).eq("id", jobId);
          }
        })();
        // @ts-ignore — EdgeRuntime.waitUntil is provided by Supabase Edge runtime
        if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
          // @ts-ignore
          (EdgeRuntime as any).waitUntil(bg);
        }
        return new Response(JSON.stringify({
          ok: true, pending: true, jobId, requestedModel: model, provider: imageProvider,
          message: "High-quality image is generating in the background. This usually takes 90–180 seconds.",
        }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Synchronous path: medium / low / non-OpenAI ──
      let mime = "image/png";
      let bytes: Uint8Array;

      if (useOpenAI) {
        try {
          const url = await runOpenAiImage({ quality: requestedQuality, abortMs: 110_000 });
          await supa.from("prompts").insert({
            project_id: doc.project_id, scope: "document-image", target_id: documentId,
            original_prompt: imgPrompt, final_prompt: imgPrompt, provider: imageProvider, model,
          });
          return new Response(JSON.stringify({ ok: true, url, requestedModel: model, effectiveModel: model, provider: imageProvider, fallback: "none" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = (e as Error)?.message ?? "Unknown";
          const aborted = (e as Error)?.name === "AbortError" || /aborted/i.test(msg);
          if (aborted) {
            return new Response(JSON.stringify({ error: `OpenAI image generation timed out after 110s at ${requestedQuality} quality. Switch to "High" (runs in background) or use a Nano Banana model.` }), { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (/\b429\b/.test(msg)) return new Response(JSON.stringify({ error: msg }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          if (/\b40[13]\b/.test(msg)) return new Response(JSON.stringify({ error: msg }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // Non-OpenAI image providers
      try {
        const result = await generateImage({ prompt: imgPrompt, model });
        bytes = result.bytes;
        mime = result.mime;
      } catch (e) {
        if (e instanceof ImageGenError) {
          const provider = e.provider === "gemini-direct" ? "Google Gemini" : "direct image provider";
          if (e.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          if (e.status === 402) return new Response(JSON.stringify({ error: `${provider} credits/key issue` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          if (e.status === 401 || e.status === 403) return new Response(JSON.stringify({ error: `${provider} auth failed — check Settings → API keys` }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          return new Response(JSON.stringify({ error: `${provider} image generation failed` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        throw e;
      }

      const ext = mime.split("/")[1] ?? "png";
      const path = `${doc.project_id}/${documentId}-${Date.now()}.${ext}`;
      await supa.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: true });
      const { data: pub } = supa.storage.from("documents").getPublicUrl(path);
      await supa.from("documents").update({ generated_asset_url: pub.publicUrl, active_version: "generated", status: "review", document_model: model, document_provider: imageProvider }).eq("id", documentId);
      await mirrorStatusOnNodes("generated");
      await supa.from("prompts").insert({
        project_id: doc.project_id, scope: "document-image", target_id: documentId,
        original_prompt: imgPrompt, final_prompt: imgPrompt, provider: imageProvider, model,
      });
      await supa.from("media_assets").insert({
        project_id: doc.project_id, category: "document", title: doc.title, url: pub.publicUrl,
        mime_type: mime, prompt: imgPrompt, provider: imageProvider, model, effective_model: model,
        asset_type: "image", document_format: "image", source_document_id: documentId,
        created_by_message_id: doc.created_by_message_id ?? null, generation_mode: "image_generation",
        status: "generated", error_message: null,
      } as never);

      return new Response(JSON.stringify({ ok: true, url: pub.publicUrl, requestedModel: model, effectiveModel: model, provider: imageProvider, fallback: "none" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------------------------------------------------------------
    // image_to_pdf — wrap the document's existing generated image into a
    // single full-bleed PDF page. No model call; pure pdf-lib. Used by the
    // bulk orchestrator when the user wants "save all images as PDF".
    // ---------------------------------------------------------------------
    if (mode === "image_to_pdf") {
      const imgUrl = doc.generated_asset_url || doc.uploaded_asset_url;
      if (!imgUrl) {
        return new Response(JSON.stringify({ error: "No image to wrap — generate the image first." }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const imgResp = await fetch(imgUrl);
        if (!imgResp.ok) throw new Error(`Could not fetch source image (${imgResp.status})`);
        const ct = (imgResp.headers.get("content-type") || "").toLowerCase();
        const bytes = new Uint8Array(await imgResp.arrayBuffer());
        const { PDFDocument } = await import("https://esm.sh/pdf-lib@1.17.1");
        const pdfDoc = await PDFDocument.create();
        const isPng = ct.includes("png") || imgUrl.toLowerCase().endsWith(".png");
        const embedded = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        // Pick page size based on document.print_size (defaults to A4).
        const SIZES: Record<string, [number, number]> = {
          A3: [841.89, 1190.55],
          A4: [595.28, 841.89],
          A5: [419.53, 595.28],
          A6: [297.64, 419.53],
          "Business card": [243.78, 153.07],
        };
        const wantedSize = (doc.print_size && SIZES[doc.print_size]) ? SIZES[doc.print_size] : SIZES.A4;
        // Match orientation to image aspect ratio.
        const imgRatio = embedded.width / embedded.height;
        let [pw, ph] = wantedSize;
        if ((imgRatio > 1 && pw < ph) || (imgRatio < 1 && pw > ph)) [pw, ph] = [ph, pw];
        const page = pdfDoc.addPage([pw, ph]);
        // Cover (full bleed) — scale image to fill page, center.
        const scale = Math.max(pw / embedded.width, ph / embedded.height);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        const pdfBytes = await pdfDoc.save();
        const path = `${doc.project_id}/${documentId}/wrapped-${Date.now()}.pdf`;
        await supa.storage.from("documents").upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
        const { data: pub } = supa.storage.from("documents").getPublicUrl(path);
        await supa.from("documents").update({
          generated_pdf_url: pub.publicUrl,
          generated_document_url: pub.publicUrl,
          document_format: "pdf",
          document_provider: "image-wrap",
          document_model: "pdf-lib",
          status: "review",
        }).eq("id", documentId);
        await supa.from("media_assets").insert({
          project_id: doc.project_id, category: "document", title: doc.title, url: pub.publicUrl,
          mime_type: "application/pdf", prompt: `wrap_image:${imgUrl}`, provider: "image-wrap", model: "pdf-lib", effective_model: "pdf-lib",
          asset_type: "document", document_format: "pdf", source_document_id: documentId,
          created_by_message_id: doc.created_by_message_id ?? null, generation_mode: "image_to_pdf",
          status: "generated", error_message: null,
        } as never);
        return new Response(JSON.stringify({ ok: true, documentUrl: pub.publicUrl, documentFormat: "pdf", model: "pdf-lib" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "image_to_pdf failed";
        console.error("[image_to_pdf]", msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Unknown mode" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-document error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

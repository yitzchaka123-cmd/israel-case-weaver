// Generate document content + optional image. Routes through direct provider
// keys only for document work; no hidden Lovable AI fallback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, providerLabel, generateImage, ImageGenError, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { loadClaudeSkillsForSurface, preferredClaudeDocumentSkill, type ClaudeSkillRow } from "../_shared/claude-skills.ts";

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
  const [{ data: finalDocs }, { data: envelopes }, { data: suspects }, { data: existingDocs }] = await Promise.all([
    supa.from("canvas_nodes").select("id, title, description, data, created_at").eq("project_id", projectId).eq("board", "final").eq("node_type", "document").order("position_y", { ascending: true }),
    supa.from("envelopes").select("number, label, task").eq("project_id", projectId).order("number", { ascending: true }),
    supa.from("suspects").select("name, role_in_case").eq("project_id", projectId).order("position", { ascending: true }),
    supa.from("documents").select("id, doc_number, title, doc_type, print_size, envelope_number, status, created_at").eq("project_id", projectId).order("doc_number", { ascending: true, nullsFirst: false }),
  ]);

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
    text: [
      `FINAL FLOW DOCUMENT NODES (authoritative list for Doc 0):`,
      docNodes.map((d: any) => `- #${d.docNumber} ${d.title} (${d.docType}, ${d.printSize})${d.envelopeNumber ? ` — envelope ${d.envelopeNumber}` : ""}. Purpose: ${d.purpose}`).join("\n") || "(none)",
      `\nENVELOPES:`,
      (envelopes ?? []).map((e: any) => `- Envelope ${e.number}: ${e.label ?? ""}${e.task ? ` — ${e.task}` : ""}`).join("\n") || "(none)",
      `\nSUSPECTS / CAST INSERTS:`,
      (suspects ?? []).map((s: any) => `- ${s.name}${s.role_in_case ? ` — ${s.role_in_case}` : ""}`).join("\n") || "(none)",
      `\nEXISTING DOCUMENT ROWS (for status only; do not invent missing inventory from these if Final Flow differs):`,
      (existingDocs ?? []).map((d: any) => `- #${d.doc_number ?? "?"} ${d.title} (${d.doc_type ?? "document"}, ${d.print_size ?? "A4"})${d.envelope_number ? ` — envelope ${d.envelope_number}` : ""}`).join("\n") || "(none)",
    ].join("\n"),
  };
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
    const { documentId, mode, imageModelOverride, quality: qualityOverride, documentFormat = "pdf" } = await req.json() as { documentId: string; mode: "text" | "image" | "document"; imageModelOverride?: string; quality?: "low" | "medium" | "high"; documentFormat?: "pdf" | "docx" | "pptx" | "xlsx" };
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

    if (mode === "text") {
      const model = resolveDocumentModel(project);
      const blocked = directProviderBlock(model, "document text");
      if (blocked) return blocked;
      const doc0 = isDoc0(doc);
      const inventory = doc0 ? await loadDoc0InventoryContext(supa, doc.project_id) : null;
      if (doc0 && !inventory?.hasFinalMap) {
        return new Response(JSON.stringify({ error: "Doc 0 must be generated from the Final Flow. Create the Final Documents Map first, then retry Doc 0." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sys = doc0
        ? `You write Doc 0 for premium printable mystery games. Doc 0 is NEVER evidence and NEVER a normal memo. It is the player-facing box contents / case-file inventory. Output ONLY the document body in ${gameLanguage}, ${isRtl ? "RTL-ready" : "properly formatted"}. Use the supplied Final Flow document nodes as the authoritative inventory. Group by envelope/section when possible. No solution spoilers. Do not invent documents not present in the Final Flow.`
        : `You write in-game evidence documents for premium printable mystery games. Output ONLY the document body in ${gameLanguage}, ${isRtl ? "RTL-ready" : "properly formatted"}, realistic and immersive, tailored to the document type. No meta-commentary. No disclaimers. For interrogation transcripts include pauses, body language and back-and-forth. Do not reveal the full solution.`;
      const userPrompt = doc0
        ? `Case: ${project?.title ?? ""}\nGame language: ${gameLanguage}\nPlayer role: ${project?.player_role ?? ""}\nCase goal: ${project?.case_goal ?? ""}\nYear: ${project?.year ?? ""}\nSetting: ${project?.setting ?? ""}\n\nDocument to produce:\nTitle: ${doc.title}\nType: contents checklist / box inventory\nPrint size: ${doc.print_size ?? "A4"}\nDesign notes: ${doc.design_instructions ?? "—"}\n\n${inventory?.text ?? ""}\n\nWrite Doc 0 now as a clean player-facing checklist of every planned game document and physical insert. Include Doc 0 itself, opening/instruction pieces, envelopes, suspects/cast sheets if present, and all planned document nodes. Do not reveal answers, culprits, hidden logic, or generation status.`
        : `Case: ${project?.title ?? ""}\nGame language: ${gameLanguage}\nPlayer role: ${project?.player_role ?? ""}\nCase goal: ${project?.case_goal ?? ""}\nYear: ${project?.year ?? ""}\nSetting: ${project?.setting ?? ""}\n\nDocument to produce:\nTitle: ${doc.title}\nType: ${doc.doc_type ?? "generic"}\nPrint size: ${doc.print_size ?? "A4"}\nDesign notes: ${doc.design_instructions ?? "—"}\n\nWrite the full ${gameLanguage} body now.`;

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
      const directFilePrompt = `Create the final ${documentFormat.toUpperCase()} document directly if your API supports returning generated files. If you cannot return an actual file, say exactly: UNABLE_TO_CREATE_FILE.\n\nCase: ${project?.title ?? ""}\nGame language: ${gameLanguage}\nDocument title: ${doc.title}\nType: ${doc.doc_type ?? "generic"}\nPrint size: ${doc.print_size ?? "A4"}\nDesign notes: ${doc.design_instructions ?? "—"}\nContent:\n${doc.hebrew_content ?? ""}`;
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

      const imgPrompt = [
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
        designNotes ? designNotes : `Authentic, period-correct, high-detail. Treat as a real-world physical prop: realistic paper texture, period-correct typography, believable headers/stamps/signatures.\n\nADDITIONAL REALISM DETAILS — include AT LEAST 20 concrete, period-appropriate details visible on the document. Pick from (and add similar): slight paper yellowing, faint horizontal fold across the center, mild edge wear, punch-hole marks on the left margin, one or two intake/filing stamps with era-correct date format, a typed reference number, a distribution list at the bottom, a small handwritten marginal note in pen or pencil, a signature scribble above a typed name, slightly uneven line spacing, faint photocopy shadowing along one edge, a classification stamp in dark red ink, a smaller box stamp near the lower third, a discreet fictitious seal (never a real emblem), a paperclip or staple shadow, a coffee/ink ring, smudged ribbon impression, carbon-copy bleed-through where applicable, a tape-repaired tear, a tiny fingerprint smudge, perforation marks if it's a tear-off form. Every detail must be concrete and visible — not a vague "looks aged".\n\nIf this document is an unusual / creative prop (map, diagram, hand-drawn note, cipher, blueprint, matchbook, ransom note, photo collage, evidence tag, ship/building map, etc.) instead include 8–15 CREATIVE in-world touches: hand annotations, torn-and-taped corners, smudged compass roses, coded margin doodles, crayon arrows, crossed-out misspellings, hidden symbols, unusual aspect ratios, attached Polaroids, etc. — tactile prop-style authenticity over bureaucratic realism.\n\nNo cartoon style. No watermark text. No copyright marks. No real emblems, real names, or real signatures.`,
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

      let mime = "image/png";
      let bytes: Uint8Array;
      const imageProvider = useOpenAI ? (imgPref === "chatgpt-image-2" ? "openai-image2" : "openai") : (Deno.env.get("GEMINI_API_KEY") ? "gemini-direct" : "lovable-ai");

      if (useOpenAI) {
        const openAiImageKey = pickOpenAIImageKey(imgPref);
        if (!openAiImageKey) {
          return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Map print size → model-appropriate dimensions.
        // gpt-image-2 accepts arbitrary sizes when edges are multiples of 16,
        // so use a near-A4 1440x2048 instead of invalid 1448x2048.
        // gpt-image-1 only accepts a fixed set, so it keeps 1024x1536 / 1536x1024.
        const ps = (doc.print_size ?? "A4").toLowerCase();
        const portraitSizes = ["a3", "a4", "a5", "a6"];
        const isGptImage2 = model === "gpt-image-2";
        const size = isGptImage2
          ? (portraitSizes.includes(ps) ? "1440x2048"
            : ps === "business card" ? "2048x1440"
            : "1440x2048")
          : (portraitSizes.includes(ps) ? "1024x1536"
            : ps === "business card" ? "1536x1024"
            : "1024x1536");

        // Default to "medium" — gpt-image-2 at "high" can take ~2 min and exceed
        // the edge runtime budget. User can still opt into "high" explicitly.
        const quality = (qualityOverride === "high" || qualityOverride === "low" || qualityOverride === "medium")
          ? qualityOverride
          : "medium";

        // Cap at 110s — leaves headroom under the platform's ~150s kill.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 110_000);

        // NOTE: do NOT add `background` or `input_fidelity` to this body —
        // gpt-image-2 returns a 400 for either of those parameters. Defensive
        // guard: build the body explicitly and only add `moderation` for gpt-image-2.
        const openaiBody: Record<string, unknown> = {
          model,
          prompt: imgPrompt,
          size,
          quality,
          n: 1,
          output_format: "jpeg",
          output_compression: 90,
        };
        if (isGptImage2) {
          // Mystery / detective prompts (ransom notes, crime-scene props, autopsy
          // reports) often trip default moderation. gpt-image-2 supports "low".
          openaiBody.moderation = "low";
        }

        let oResp: Response;
        try {
          oResp = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { Authorization: `Bearer ${openAiImageKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(openaiBody),
            signal: controller.signal,
          });
        } catch (e) {
          clearTimeout(timer);
          const aborted = (e as Error)?.name === "AbortError";
          console.error("openai image fetch failed", e);
          return new Response(JSON.stringify({
            error: aborted
              ? `OpenAI image generation timed out after 110s. Try lowering quality to "Medium" or switch to a Nano Banana model.`
              : `OpenAI request failed: ${(e as Error)?.message ?? "network error"}`,
          }), { status: aborted ? 504 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        clearTimeout(timer);

        if (!oResp.ok) {
          const reqId = oResp.headers.get("x-request-id") ?? "";
          const t = await oResp.text();
          console.error("openai image error", oResp.status, reqId, t);
          // Try to surface the real OpenAI error message
          let realMessage = t;
          try { realMessage = JSON.parse(t)?.error?.message ?? t; } catch { /* not json */ }
          const reqIdSuffix = reqId ? ` (request id: ${reqId})` : "";

          if (oResp.status === 429) {
            const tierHint = isGptImage2
              ? ` Tier 1 OpenAI accounts are limited to 5 images/min on gpt-image-2. Wait ~60s and retry, or upgrade your OpenAI tier.`
              : "";
            return new Response(JSON.stringify({ error: `OpenAI rate limit. ${realMessage}${tierHint}${reqIdSuffix}` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (oResp.status === 403 && /verif/i.test(realMessage)) {
            return new Response(JSON.stringify({
              error: `OpenAI requires organization verification to use ${model}. Open https://platform.openai.com/settings/organization/general → Verify Organization, then retry. Or switch to "ChatGPT Image 1" or a Nano Banana model.${reqIdSuffix}`,
            }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (oResp.status === 401 || oResp.status === 403) {
            return new Response(JSON.stringify({ error: `OpenAI auth failed — ${realMessage}${reqIdSuffix}` }), { status: oResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ error: `OpenAI image generation failed (${oResp.status}): ${realMessage}${reqIdSuffix}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const oData = await oResp.json();
        const b64: string | undefined = oData.data?.[0]?.b64_json;
        if (!b64) return new Response(JSON.stringify({ error: "No image returned (OpenAI)" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        mime = "image/jpeg";
      } else {
        try {
          const result = await generateImage({ prompt: imgPrompt, model });
          bytes = result.bytes;
          mime = result.mime;
        } catch (e) {
          if (e instanceof ImageGenError) {
            const provider = e.provider === "gemini-direct" ? "Google Gemini" : "direct image provider";
            console.error(`${provider} image error`, e.status, e.message);
            if (e.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if (e.status === 402) return new Response(JSON.stringify({ error: `${provider} credits/key issue` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if (e.status === 401 || e.status === 403) return new Response(JSON.stringify({ error: `${provider} auth failed — check Settings → API keys` }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            return new Response(JSON.stringify({ error: `${provider} image generation failed` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          throw e;
        }
      }

      const ext = mime.split("/")[1] ?? "png";
      const path = `${doc.project_id}/${documentId}-${Date.now()}.${ext}`;
      await supa.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: true });
      const { data: pub } = supa.storage.from("documents").getPublicUrl(path);

      await supa.from("documents").update({ generated_asset_url: pub.publicUrl, active_version: "generated", status: "review", document_model: model, document_provider: imageProvider }).eq("id", documentId);
      await supa.from("prompts").insert({
        project_id: doc.project_id, scope: "document-image", target_id: documentId,
        original_prompt: imgPrompt, final_prompt: imgPrompt,
        provider: imageProvider,
        model,
      });
      await supa.from("media_assets").insert({
        project_id: doc.project_id,
        category: "document",
        title: doc.title,
        url: pub.publicUrl,
        mime_type: mime,
        prompt: imgPrompt,
        provider: imageProvider,
        model,
        effective_model: model,
        asset_type: "image",
        document_format: "image",
        source_document_id: documentId,
        created_by_message_id: doc.created_by_message_id ?? null,
        generation_mode: "image_generation",
        status: "generated",
        error_message: null,
      } as never);

      return new Response(JSON.stringify({ ok: true, url: pub.publicUrl, requestedModel: model, effectiveModel: model, provider: imageProvider, fallback: "none" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

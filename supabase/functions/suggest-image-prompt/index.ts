// Generates a contextually-aware image prompt for a project, using the
// project's title/genre/setting/suspects/etc. so the resulting image fits the
// rest of the game. Routes through the shared AI router (OpenAI direct when
// the user picked an openai/* planning model, otherwise Lovable AI Gateway).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { resolvePlaybook, renderEnvelopeDesignTemplate } from "../_shared/assistant-playbook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mirrors assistant-chat / generate-document so the same provider key resolves
// the same way everywhere. See ai-router.ts for prefix routing rules.
const PLANNING_MODEL: Record<string, string> = {
  lovable: "google/gemini-2.5-flash",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.4": "openai/gpt-5.2",
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

const CATEGORY_GUIDANCE: Record<string, string> = {
  cover: "Front cover art for the boxed mystery game. Eye-catching, evocative, hints at the case without spoiling it. Genre-appropriate atmosphere. Title space friendly (composition leaves room near top).",
  back: "Back-of-box hero illustration. Shows tone and stakes. Slightly more revealing than the cover but still spoiler-free.",
  news: "A still frame as if from a televised news report covering the case. Lower-third / chyron friendly. Photorealistic, broadcast feel.",
  promo: "Cinematic key art / promo still that could anchor a short trailer. Dramatic lighting, strong silhouette.",
  external: "A general supporting visual related to the case world.",
  envelope: "A full A4 in-world page insert that will be placed inside a physical envelope. It should look like a real briefing/recap/task sheet, not an envelope cover: no flap, no wax seal, no mailer. Use varied page-specific realism and avoid repeated generic coffee stains.",
  "hint-sheet": "A printable single-side hint card (A6/A7 portrait), designed to slip into the case folder. Large RTL Hebrew stage label at the top (e.g. \"רמז שלב N\"), three clearly-marked panels below (1 / 2 / 3) sized for scratch-off coatings — leave them visually empty/blank, NO Hebrew hint text inside the panels (those are placeholders for physical scratch-off labels). Era-appropriate paper texture matching the case (vintage, noir, sci-fi, etc.). Tactile and authentic, not Canva-flat. NO spoilers visible — just the structure and chrome of a printed hint card.",
};

interface Body {
  projectId: string;
  category?: string;
  hint?: string; // optional user steering ("focus on the rainy alley")
  currentPrompt?: string; // if revising
  writerModel?: string;   // override key from PLANNING_MODEL (per-image dropdown)
  userId?: string;        // for global "image prompt assistant instructions"
  // Structured-doc mode (Documents + Envelopes only)
  documentId?: string;
  envelopeId?: string;
  userInstructions?: string; // free-text steering from Tab 1 of the new assistant
  currentDesign?: string;    // existing design_instructions to revise
  currentContent?: string;   // existing content (hebrew_content / envelope task) to revise
  // Inline-image mode — embedded image inside a document slot
  inlineImageId?: string;
}

const STRUCTURED_DOC = "document-structured";
const STRUCTURED_ENV = "envelope-structured";
const INLINE_IMAGE = "inline-image";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { projectId, category = "cover", hint, currentPrompt, writerModel, userId } = body;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);

    const { data: project } = await supa
      .from("projects")
      .select("title, subtitle, genre, setting, year, mystery_type, player_role, case_goal, selling_point, image_prompt_instructions, ai_provider_planning, owner_id")
      .eq("id", projectId)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: suspects } = await supa
      .from("suspects")
      .select("name, role_in_case, summary")
      .eq("project_id", projectId)
      .order("position")
      .limit(8);

    // Pull global "image prompt assistant instructions" + workspace-default
    // prompt-writer model from the user's profile.
    const profileOwnerId = userId ?? project.owner_id;
    let globalAssistantInstructions = "";
    let envelopeTemplateBlock = "";
    let envelopeBrandingBlock = "";
    let profilePromptWriter = "";
    if (profileOwnerId) {
      const { data: profile } = await supa
        .from("profiles")
        .select("image_prompt_assistant_instructions, assistant_playbook, ai_provider_prompt_writer")
        .eq("id", profileOwnerId)
        .maybeSingle();
      globalAssistantInstructions = ((profile as { image_prompt_assistant_instructions?: string } | null)?.image_prompt_assistant_instructions ?? "").trim();
      profilePromptWriter = ((profile as { ai_provider_prompt_writer?: string } | null)?.ai_provider_prompt_writer ?? "").trim();
      if (category === "envelope" || category === STRUCTURED_ENV) {
        const playbook = resolvePlaybook((profile as { assistant_playbook?: unknown } | null)?.assistant_playbook);
        envelopeTemplateBlock = `\n\n${renderEnvelopeDesignTemplate(playbook)}`;
        // Pull workspace branding so page inserts carry the logo.
        const { data: cp } = await supa
          .from("company_profiles")
          .select("company_name, tagline, logo_url")
          .eq("owner_id", profileOwnerId)
          .maybeSingle();
        const brand = cp as { company_name?: string | null; tagline?: string | null; logo_url?: string | null } | null;
        envelopeBrandingBlock = brand?.logo_url
          ? `\n\nCOMPANY BRANDING (must be reflected in the A4 page insert design):
- Company: ${brand.company_name ?? "(unspecified)"}
- Tagline: ${brand.tagline ?? "(none)"}
- Logo URL: ${brand.logo_url}
Require the brief to place the logo in the top letterhead/header area of the A4 page insert (top-center, top-left, or top-right — pick the spot that frames this page best). Logo height ≈ 5–9% of the page's longer side, with breathing room from stamps, file codes, and title text. Treat the logo as if printed onto the page (matte ink, period-correct registration), NOT a sticker, NOT a watermark, no drop shadows. Render the company name in small clean type beside or beneath the logo when supplied.`
          : `\n\nCOMPANY BRANDING: no company logo configured for this workspace — do NOT invent one. Skip the branding lockup entirely.`;
      }
    }

    // Resolve writer model: explicit per-call override → workspace prompt-writer
    // default → project's planning provider → lovable.
    const projectKey = (writerModel && PLANNING_MODEL[writerModel])
      ? writerModel
      : (profilePromptWriter && PLANNING_MODEL[profilePromptWriter])
        ? profilePromptWriter
        : ((project.ai_provider_planning as string) || "lovable");
    const model = PLANNING_MODEL[projectKey] ?? PLANNING_MODEL.lovable;

    // Shared project context block — used by both the structured-doc mode and
    // the legacy single-prompt path below.
    const ctx = [
      project.title && `Title: ${project.title}`,
      project.subtitle && `Subtitle: ${project.subtitle}`,
      project.genre && `Genre: ${project.genre}`,
      project.mystery_type && `Mystery type: ${project.mystery_type}`,
      project.setting && `Setting: ${project.setting}`,
      project.year && `Year: ${project.year}`,
      project.player_role && `Player role: ${project.player_role}`,
      project.case_goal && `Case goal: ${project.case_goal}`,
      project.selling_point && `Selling point: ${project.selling_point}`,
      project.image_prompt_instructions && `Project image style notes: ${project.image_prompt_instructions}`,
      suspects?.length && `Key characters: ${suspects.map((s) => `${s.name}${s.role_in_case ? ` (${s.role_in_case})` : ""}`).join("; ")}`,
    ].filter(Boolean).join("\n");

    // ─────────────────────────────────────────────────────────────────────
    // STRUCTURED-DOC MODE — Documents + Envelopes only.
    // Returns { design_instructions, content } in one shot. Used by the new
    // DocumentPromptAssistant (2-tab UI). All other categories fall through
    // to the legacy single-prompt path below.
    // ─────────────────────────────────────────────────────────────────────
    if (category === STRUCTURED_DOC || category === STRUCTURED_ENV) {
      const { documentId, envelopeId, userInstructions, currentDesign, currentContent } = body;

      // Resolve the project's chosen game language for the content half.
      const { data: projectLang } = await supa
        .from("projects")
        .select("game_language, solution_summary")
        .eq("id", projectId)
        .maybeSingle();
      const gameLanguage = ((projectLang as { game_language?: string } | null)?.game_language ?? "Hebrew").trim();
      const solutionSummary = ((projectLang as { solution_summary?: string } | null)?.solution_summary ?? "").trim();
      const isRtl = /^(hebrew|arabic|persian|farsi|urdu|yiddish)$/i.test(gameLanguage);

      // Load the specific document or envelope so the assistant has its facts.
      let targetBlock = "";
      if (category === STRUCTURED_DOC && documentId) {
        const { data: docRow } = await supa
          .from("documents")
          .select("doc_number, title, doc_type, print_size, envelope_number, design_instructions, hebrew_content")
          .eq("id", documentId)
          .maybeSingle();
        if (docRow) {
          targetBlock = [
            `THIS DOCUMENT:`,
            docRow.doc_number !== null && `- Number: ${docRow.doc_number}`,
            docRow.title && `- Title: ${docRow.title}`,
            docRow.doc_type && `- Type / format hint (NOT binding — you may invent a better-fitting format): ${docRow.doc_type}`,
            docRow.print_size && `- Print size: ${docRow.print_size}`,
            docRow.envelope_number !== null && `- Belongs to envelope: ${docRow.envelope_number}`,
          ].filter(Boolean).join("\n");
        }

        // Load sibling documents so the assistant can pick a format that's
        // distinct from the rest of the case and coherent with the whole story.
        const { data: siblingDocs } = await supa
          .from("documents")
          .select("doc_number, title, doc_type")
          .eq("project_id", projectId)
          .neq("id", documentId)
          .order("doc_number", { ascending: true });
        if (siblingDocs && siblingDocs.length > 0) {
          const siblingLines = siblingDocs
            .map((s) => {
              const num = s.doc_number !== null && s.doc_number !== undefined ? `#${s.doc_number} ` : "";
              const title = s.title || "(untitled)";
              const type = s.doc_type ? ` — ${s.doc_type}` : "";
              return `- ${num}"${title}"${type}`;
            })
            .join("\n");
          targetBlock += `\n\nSIBLING DOCUMENTS IN THIS CASE (for variety — don't duplicate their format/paper/era unless the story specifically demands it):\n${siblingLines}`;
        }
      } else if (category === STRUCTURED_ENV && envelopeId) {
        const { data: envRow } = await supa
          .from("envelopes")
          .select("number, label, task, design_instructions")
          .eq("id", envelopeId)
          .maybeSingle();
        if (envRow) {
          targetBlock = [
            `THIS ENVELOPE SLOT / PAGE INSERT:`,
            envRow.number !== null && `- Number: ${envRow.number}`,
            envRow.label && `- Current label: ${envRow.label}`,
            envRow.task && `- Current task: ${envRow.task}`,
            `- Print: a full A4 page insert placed inside a physical envelope. Not an envelope cover.`,
          ].filter(Boolean).join("\n");
        }
      }

      const isEnv = category === STRUCTURED_ENV;
      const structuredSystem = [
        `You are a master prop designer AND in-world writer for a premium boxed murder-mystery game. You produce TWO things in a single JSON response: a graphic-design brief and the final printable content.`,
        ``,
        `╔══════════════════════════════════════════════════════════════════╗`,
        `║ ABSOLUTE RULE #1 — USER INSTRUCTIONS OVERRIDE EVERYTHING BELOW. ║`,
        `╚══════════════════════════════════════════════════════════════════╝`,
        `If the user gives ANY instruction (length cap, tone, wording, "tiny letters", "one sentence only", "no stamps", etc.), that instruction is law. It overrides every default rule in this prompt — including the default preference for extreme detail. The instruction applies to the COMBINED output: design_instructions + content together. If the user says "keep under 20 words", the TOTAL word count of both fields combined must be ≤ 20. No exceptions.`,
        ``,
        `EXAMPLES OF USER INSTRUCTIONS — handle them like this:`,
        `  • "for example", "e.g.", "such as", "like for instance" → what follows is an ILLUSTRATION OF INTENT ONLY. Do NOT copy those literal words or examples into the output. Use them to understand the user's taste, then write your own original equivalent.`,
        `    User: "tiny letters, for example only" → Design uses very small typography (e.g. 7–8 pt body). The phrase "for example only" NEVER appears in the output.`,
        `  • "keep it short" → Both fields stay short. Skip the exhaustive bullet list.`,
        `  • "no realism" → Design says "no stamps, no aging, no fold lines, clean printer-paper look".`,
        ``,
        `═══════════════════════════════════════════════════════════════════`,
        `DEFAULT BEHAVIOR — applies ONLY when the user gave no relevant instruction:`,
        `═══════════════════════════════════════════════════════════════════`,
        ``,
        `Part 1 — DESIGN_INSTRUCTIONS (English): a detailed graphic-design brief covering whichever of these are relevant:`,
        `  • Document type / output format (e.g. "single A4 portrait page, 2480x3508px, 300 DPI, flat archival scan").`,
        `  • Paper stock (weight, finish, age, color).`,
        `  • Look & feel (administrative / dramatic / aged / clean / etc.) and how strongly to apply realism.`,
        `  • Typography: exact fonts (or font families), sizes, weights for title / headers / body / footnotes. RTL or LTR direction.`,
        `  • Full layout, section by section. Margins. Alignment.`,
        `  • Color palette / ink colors / stamp colors.`,
        `  • Stamps, handwriting, signatures, marginalia, holes, fold lines, tape, smudges — INCLUDE ONLY if the document calls for them. For clean admin docs, explicitly say "no stamps, no handwriting, no realism details".`,
        `  • Footer / header rules.`,
        `  • Explicit "do NOT include" rules (e.g. no real names, no real emblems, no modern Canva styling, no watermark text).`,
        `  Default to exhaustive senior-print-designer detail — but ONLY when the user did not ask for brevity.`,
        ``,
        `Part 2 — CONTENT (${gameLanguage}, ${isRtl ? "RTL" : "LTR"}): the EXACT final text that appears on the ${isEnv ? "A4 page insert inside this physical envelope" : "document"}. Ready to typeset. No meta-commentary, no English explanations inside the content, no placeholders like "[insert name here]", no markdown headings — just the actual prop text in ${gameLanguage}. Names, dates, numbers, quotes — all final.`,
        ``,
        isEnv
          ? `Envelope-slot rules: produce an A4 page insert, not the outside of an envelope. Design it as the full printed briefing/recap/task page that goes inside the physical envelope. Choose a DISTINCT document type for THIS page (e.g. typewritten memo, dispatch telegram, handwritten note, mimeograph bulletin, courier receipt, registrar letter, casebook page, dossier cover sheet, index card, ledger page, etc.) — it must not duplicate the document type or paper of the other envelope pages in this set. Pick realism details that belong specifically to THAT chosen document type and era; do NOT reuse coffee stains, fold lines, binder holes, fax noise, carbon-copy offset, redaction tape, or any other tactile motif that already appears on a sibling envelope page. Never reveal the case solution.`
          : `Document-specific rules: stay in-world; do not reveal the full solution; honor the document's planned role inside the case.\n\nDOCUMENT-TYPE CREATIVITY: You have full creative license to choose the document type / format that BEST serves (a) the overall mystery's tone, era, setting, and stakes, and (b) this specific document's role in the case. The doc_type field above is a hint from earlier planning — feel free to invent a more fitting format if you can justify it from the story (e.g. a coroner's intake card, a backstage call sheet, a hand-drawn map on a napkin scrap, a confessional transcript, a hotel switchboard log, a dictaphone transcription, a redacted internal memo, a child's school exercise book page, a torn diary leaf, a betting-shop slip, a pawnshop ticket — whatever the world of THIS case calls for). Pick paper, ink, typography, and realism details that belong specifically to that chosen format and era.\n\nVARIETY ACROSS THE CASE: Look at the SIBLING DOCUMENTS list above. Don't duplicate a sibling's document type, paper, or era unless the story specifically demands a matched pair (e.g. "two telegrams from the same correspondent"). Each document should feel like a distinct physical artifact a player would pick up and immediately recognize as different from the last one.\n\nDOC 0 EXCEPTION: If this is doc 0 / contents inventory, the design must be a plain white printer-paper sheet (no realism), and content is a numbered list of every game document.`,
        ``,
        `OUTPUT FORMAT: a single strict JSON object with EXACTLY these two string keys: {"design_instructions": "...", "content": "..."}. No prose around it, no markdown fences, no extra keys.`,
        globalAssistantInstructions
          ? `\nWORKSPACE STYLE GUIDE (apply to every brief unless the per-doc user instruction overrides it):\n${globalAssistantInstructions}`
          : "",
        isEnv && envelopeBrandingBlock ? envelopeBrandingBlock : "",
      ].filter(Boolean).join("\n");

      // Put USER STEERING at the TOP of the user message so it's the first thing the model reads.
      const structuredUser = [
        userInstructions?.trim()
          ? `╔════════════════════════════════════════════════════════════╗\n║  USER INSTRUCTIONS FOR THIS ${isEnv ? "ENVELOPE" : "DOCUMENT"} — HIGHEST PRIORITY  ║\n╚════════════════════════════════════════════════════════════╝\n${userInstructions.trim()}\n\nThese instructions OVERRIDE every default rule. They apply to design_instructions + content COMBINED. If they conflict with "be detailed" or any other default, the user wins. Phrases like "for example" / "e.g." / "such as" mean the example is an illustration of intent — do NOT copy those literal example words into the output.`
          : `USER INSTRUCTIONS FOR THIS ${isEnv ? "ENVELOPE" : "DOCUMENT"}: (none — use project context and the target's title/type to decide everything; default to detailed)`,
        ``,
        `─────────────────────────────────────────────────────────────`,
        `PROJECT CONTEXT:`,
        ctx || "(no context yet)",
        ``,
        `GAME LANGUAGE: ${gameLanguage} (${isRtl ? "RTL" : "LTR"})`,
        solutionSummary ? `\nSOLUTION SUMMARY (for coherence — do NOT reveal in this artifact):\n${solutionSummary}` : "",
        ``,
        targetBlock,
        currentDesign?.trim() ? `\nCURRENT DESIGN INSTRUCTIONS (revise / improve, don't repeat verbatim):\n${currentDesign.trim()}` : "",
        currentContent?.trim() ? `\nCURRENT CONTENT (revise / improve, don't repeat verbatim):\n${currentContent.trim()}` : "",
        ``,
        `Now produce the JSON object. The USER INSTRUCTIONS at the top of this message are absolute — obey them across design_instructions + content combined.`,
      ].filter(Boolean).join("\n");

      const supportsTempStruct = !model.startsWith("openai/");
      const supportsJsonMode = model.startsWith("openai/") || model.startsWith("google/") || model.startsWith("gemini-direct/");
      const startedAtStruct = Date.now();
      const callerUserIdStruct = await getUserIdFromAuth(req);
      const respStruct = await chatCompletions({
        model,
        messages: [
          { role: "system", content: structuredSystem },
          { role: "user", content: structuredUser },
        ],
        ...(supportsTempStruct ? { temperature: 0.85 } : {}),
        ...(supportsJsonMode ? { response_format: { type: "json_object" } } : {}),
      });
      const fbStruct = extractFallback(respStruct, model);

      if (!respStruct.ok) {
        const t = await respStruct.text().catch(() => "");
        console.error("suggest-image-prompt structured error", respStruct.status, t);
        const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
        await logAiRun({
          userId: callerUserIdStruct, projectId, surface: `suggest-image-prompt:${category}`,
          requestedModel: model, effectiveModel: fbStruct.effectiveModel, fallback: fbStruct.fallback,
          status: "error", latencyMs: Date.now() - startedAtStruct,
          errorMessage: `${provider} ${respStruct.status}: ${t.slice(0, 200)}`,
          promptExcerpt: structuredUser,
        });
        if (respStruct.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (respStruct.status === 402) return new Response(JSON.stringify({ error: `${provider} credits/key issue (status 402).` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: `${provider} error (status ${respStruct.status})` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const dataStruct = await respStruct.json();
      const raw: string = (dataStruct.choices?.[0]?.message?.content ?? "").trim();
      // Robust parse: try JSON first, then fenced JSON, then a labeled-section fallback.
      let designOut = "";
      let contentOut = "";
      const tryParse = (s: string): { d?: string; c?: string } | null => {
        try {
          const j = JSON.parse(s);
          if (j && typeof j === "object") {
            return { d: typeof j.design_instructions === "string" ? j.design_instructions : undefined, c: typeof j.content === "string" ? j.content : undefined };
          }
        } catch { /* ignore */ }
        return null;
      };
      const direct = tryParse(raw);
      if (direct?.d || direct?.c) { designOut = direct.d ?? ""; contentOut = direct.c ?? ""; }
      if (!designOut && !contentOut) {
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) {
          const f = tryParse(fenced[1].trim());
          if (f?.d || f?.c) { designOut = f.d ?? ""; contentOut = f.c ?? ""; }
        }
      }
      if (!designOut && !contentOut) {
        // Labeled-section fallback.
        const dMatch = raw.match(/design[_\s-]*instructions\s*[:\n]+([\s\S]*?)(?:\n\s*content\s*[:\n]|$)/i);
        const cMatch = raw.match(/(?:^|\n)\s*content\s*[:\n]+([\s\S]*)$/i);
        if (dMatch) designOut = dMatch[1].trim();
        if (cMatch) contentOut = cMatch[1].trim();
      }
      if (!designOut && !contentOut) {
        // Last resort: dump the raw text into design so the user can salvage it.
        designOut = raw;
      }

      await logAiRun({
        userId: callerUserIdStruct, projectId, surface: `suggest-image-prompt:${category}`,
        requestedModel: model, effectiveModel: fbStruct.effectiveModel, fallback: fbStruct.fallback,
        status: "ok", latencyMs: Date.now() - startedAtStruct, promptExcerpt: structuredUser,
      });
      return new Response(JSON.stringify({
        design_instructions: designOut,
        content: contentOut,
        model,
        effectiveModel: fbStruct.effectiveModel,
        fallback: fbStruct.fallback,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─────────────────────────────────────────────────────────────────────
    // INLINE-IMAGE MODE — slot embedded inside a document (e.g. drone shots
    // at the bottom of a surveillance report). Anchor-aware: when the slot
    // has an anchor, the writer locks visual properties to it and only
    // varies framing per the user's brief. Returns { prompt }.
    // ─────────────────────────────────────────────────────────────────────
    if (category === INLINE_IMAGE) {
      const { inlineImageId, userInstructions } = body;
      if (!inlineImageId) {
        return new Response(JSON.stringify({ error: "inlineImageId required for inline-image category" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: slot } = await supa
        .from("document_inline_images")
        .select("id, document_id, slot_label, prompt, position, group_key, is_anchor, anchor_image_id")
        .eq("id", inlineImageId)
        .maybeSingle();
      if (!slot) {
        return new Response(JSON.stringify({ error: "Inline image slot not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: docRow } = await supa
        .from("documents")
        .select("title, doc_type, design_instructions, inline_images_caption, inline_images_layout")
        .eq("id", (slot as { document_id: string }).document_id)
        .maybeSingle();

      let anchorRow: { slot_label: string; prompt: string | null; url: string | null } | null = null;
      if ((slot as { anchor_image_id: string | null }).anchor_image_id) {
        const { data: a } = await supa
          .from("document_inline_images")
          .select("slot_label, prompt, url")
          .eq("id", (slot as { anchor_image_id: string }).anchor_image_id)
          .maybeSingle();
        if (a) anchorRow = a as typeof anchorRow;
      }

      const { data: siblings } = (slot as { group_key: string | null }).group_key
        ? await supa
            .from("document_inline_images")
            .select("slot_label, prompt, position")
            .eq("document_id", (slot as { document_id: string }).document_id)
            .eq("group_key", (slot as { group_key: string }).group_key)
            .neq("id", (slot as { id: string }).id)
            .order("position", { ascending: true })
        : { data: [] as Array<{ slot_label: string; prompt: string | null; position: number }> };

      const isAnchor = (slot as { is_anchor: boolean }).is_anchor || !anchorRow;

      const inlineSystem = [
        `You are an expert art director writing a single image prompt for an image embedded inside a printed game prop document (e.g. surveillance photo at the bottom of a drone report, evidence photo on a case file). Output ONLY the prompt — no preamble, no quotes, no markdown.`,
        ``,
        isAnchor
          ? `THIS IS THE ANCHOR / REFERENCE IMAGE for its slot group. Commit to a strong, opinionated visual identity (camera/sensor type, lens feel, lighting, palette, framing language, post-processing) — sibling slots will be generated as variations of this image and inherit those properties.`
          : `THIS IS A CHILD / SIBLING IMAGE in a group anchored by another slot. Your prompt MUST lock the following visual properties to match the anchor exactly: camera/sensor type and lens feel, lighting (time, direction, weather, color temp), palette and grading, subject style, post-processing (grain, sharpness, contrast). VARY ONLY the framing/angle/foreground per this slot's brief. The output must read as the same camera operator shooting moments later.`,
        ``,
        globalAssistantInstructions
          ? `USER GLOBAL STYLE GUIDE (highest priority):\n${globalAssistantInstructions}`
          : "",
      ].filter(Boolean).join("\n");

      const slotRow = slot as { slot_label: string; prompt: string | null; position: number; group_key: string | null };
      const docMeta = docRow as { title?: string; doc_type?: string | null; design_instructions?: string | null; inline_images_caption?: string | null; inline_images_layout?: string | null } | null;

      const inlineUser = [
        userInstructions?.trim()
          ? `╔════════════════════════════════════════════════════════════╗\n║  USER INSTRUCTIONS FOR THIS SLOT — HIGHEST PRIORITY        ║\n╚════════════════════════════════════════════════════════════╝\n${userInstructions.trim()}\n`
          : `USER INSTRUCTIONS FOR THIS SLOT: (none — derive everything from project + document + anchor context)`,
        ``,
        `PROJECT CONTEXT:`,
        ctx || "(no context yet)",
        ``,
        `PARENT DOCUMENT:`,
        `- Title: ${docMeta?.title ?? "Document"}`,
        docMeta?.doc_type ? `- Type: ${docMeta.doc_type}` : "",
        docMeta?.inline_images_layout ? `- Inline image layout: ${docMeta.inline_images_layout}` : "",
        docMeta?.inline_images_caption ? `- Shared caption: ${docMeta.inline_images_caption}` : "",
        docMeta?.design_instructions ? `- Document design context: ${docMeta.design_instructions}` : "",
        ``,
        `THIS SLOT:`,
        `- Label: ${slotRow.slot_label}`,
        `- Position in document: ${slotRow.position + 1}`,
        slotRow.group_key ? `- Group: ${slotRow.group_key}` : "",
        slotRow.prompt?.trim() ? `- Current prompt (revise / improve, do not repeat verbatim):\n${slotRow.prompt.trim()}` : "",
        ``,
        anchorRow ? [
          `ANCHOR REFERENCE IMAGE (the locked look you must match):`,
          `- Anchor slot: "${anchorRow.slot_label}"`,
          `- Anchor prompt: ${anchorRow.prompt ?? "(no prompt available)"}`,
          anchorRow.url ? `- Anchor image URL (will be passed to the image model as a reference): ${anchorRow.url}` : "",
          ``,
          `Write a prompt that EXPLICITLY restates the locked properties (camera, lighting, palette, look) AND describes ONLY this slot's variation (angle / framing / foreground).`,
        ].join("\n") : "",
        siblings && siblings.length > 0 && isAnchor ? [
          ``,
          `SIBLING SLOTS that will inherit this anchor's look (write the anchor knowing these will follow):`,
          ...siblings.map((s) => `- "${s.slot_label}"${s.prompt ? `: ${s.prompt}` : ""}`),
        ].join("\n") : "",
        ``,
        `Now write the single image prompt. Only the prompt itself.`,
      ].filter(Boolean).join("\n");

      const supportsTempInline = !model.startsWith("openai/");
      const startedAtInline = Date.now();
      const callerUserIdInline = await getUserIdFromAuth(req);
      const respInline = await chatCompletions({
        model,
        messages: [
          { role: "system", content: inlineSystem },
          { role: "user", content: inlineUser },
        ],
        ...(supportsTempInline ? { temperature: 0.85 } : {}),
      });
      const fbInline = extractFallback(respInline, model);
      if (!respInline.ok) {
        const t = await respInline.text().catch(() => "");
        const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
        await logAiRun({
          userId: callerUserIdInline, projectId, surface: "suggest-image-prompt:inline-image",
          requestedModel: model, effectiveModel: fbInline.effectiveModel, fallback: fbInline.fallback,
          status: "error", latencyMs: Date.now() - startedAtInline,
          errorMessage: `${provider} ${respInline.status}: ${t.slice(0, 200)}`,
          promptExcerpt: inlineUser,
        });
        return new Response(JSON.stringify({ error: `${provider} error (status ${respInline.status})` }), {
          status: respInline.status === 429 ? 429 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const dataInline = await respInline.json();
      const textInline: string = (dataInline.choices?.[0]?.message?.content ?? "").trim();
      if (!textInline) {
        return new Response(JSON.stringify({ error: "Model returned an empty prompt" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await logAiRun({
        userId: callerUserIdInline, projectId, surface: "suggest-image-prompt:inline-image",
        requestedModel: model, effectiveModel: fbInline.effectiveModel, fallback: fbInline.fallback,
        status: "ok", latencyMs: Date.now() - startedAtInline, promptExcerpt: inlineUser,
      });
      return new Response(JSON.stringify({
        prompt: textInline,
        anchored: !!anchorRow,
        isAnchor,
        model,
        effectiveModel: fbInline.effectiveModel,
        fallback: fbInline.fallback,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ctx is defined above (shared with structured-doc mode).

    const guidance = CATEGORY_GUIDANCE[category] ?? CATEGORY_GUIDANCE.external;

    const baseSystem = `You are an expert art director for boxed murder-mystery games. You write concise, vivid image-generation prompts (3–6 sentences for most categories; for "envelope" produce a long structured brief with sections GOAL / OUTPUT FORMAT / VISUAL STYLE / LAYOUT / TYPOGRAPHY / AUTHENTICITY) that an image model like Gemini Nano Banana or OpenAI gpt-image will turn into a single still image. Focus on subject, composition, lighting, mood, color palette, medium/style, and lens. No camera-shake instructions, no text overlays unless requested. Never output anything except the prompt itself.`;
    const system = globalAssistantInstructions
      ? `${baseSystem}\n\nUSER GLOBAL STYLE GUIDE (highest priority — apply to every prompt you write):\n${globalAssistantInstructions}${envelopeTemplateBlock}${envelopeBrandingBlock}`
      : `${baseSystem}${envelopeTemplateBlock}${envelopeBrandingBlock}`;

    const userMsg = `PROJECT CONTEXT:\n${ctx || "(no context yet)"}\n\nIMAGE PURPOSE: ${category.toUpperCase()} — ${guidance}${
      hint ? `\n\nUSER STEERING: ${hint}` : ""
    }${currentPrompt ? `\n\nPREVIOUS PROMPT (revise / improve, don't repeat verbatim):\n${currentPrompt}` : ""}\n\nWrite the new image prompt now. Only the prompt — no preamble, no quotes, no markdown.`;

    // GPT-5 family rejects any non-default temperature ("Only the default (1)
    // value is supported"), so omit it for openai/* models.
    const supportsTemperature = !model.startsWith("openai/");
    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);
    const resp = await chatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      ...(supportsTemperature ? { temperature: 0.9 } : {}),
    });
    const fb = extractFallback(resp, model);

    if (!resp.ok) {
      const t = await resp.text();
      console.error("suggest-image-prompt provider error", resp.status, t);
      const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
      await logAiRun({
        userId: callerUserId, projectId, surface: "suggest-image-prompt",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "error", latencyMs: Date.now() - startedAt,
        errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`,
        promptExcerpt: userMsg,
      });
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: `${provider} credits/key issue (status 402). Add funds or check your key.` }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "Model returned an empty prompt" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await logAiRun({
      userId: callerUserId, projectId, surface: "suggest-image-prompt",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt: userMsg,
    });
    return new Response(JSON.stringify({ prompt: text, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-image-prompt error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

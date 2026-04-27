// Inspect a surface's system prompt: returns the hardcoded default scaffold
// (verbatim copy of what the surface's edge function would feed into
// resolveSystemPrompt as `defaultBody`) PLUS the fully assembled prompt the
// model would actually see right now (with the user's master + override
// applied), for a generic / context-free render.
//
// This intentionally does NOT inject live project context (case brief,
// suspects, doc list, etc.). For most surfaces those are appended into the
// USER message, not the system prompt — so what we return here IS what the
// model receives as `system`. The two surfaces where project context is
// folded into the system prompt itself (assistant-chat, generate-envelopes
// runtime mods) are clearly labeled in `dynamicNotes`.

import { resolveSystemPrompt } from "../_shared/system-prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Snapshot of the literal `defaultBody` strings each edge function passes to
// resolveSystemPrompt. KEEP IN SYNC when prompts change in the source.
// Each entry includes a one-line note about what dynamic context the real
// edge function appends at runtime (so users know what's NOT shown here).
const DEFAULTS: Record<string, { template: string; dynamicNotes: string }> = {
  "assistant-chat": {
    template:
      "Assembled at runtime by buildSystemPrompt() in supabase/functions/assistant-chat/index.ts. The base scaffold is your Assistant Playbook (Settings → Assistant rules), wrapped with project state and Phase-specific instructions.",
    dynamicNotes:
      "Includes: full Assistant Playbook · Assistant Tweaks · current project phase · case brief · suspects roster · approved-or-not solution flag · Claude Skills enabled for chat · whether this is the first turn.",
  },
  "generate-logic-flow:fresh": {
    template:
      "Assembled in supabase/functions/generate-logic-flow/index.ts (line ~113) when there is NO approved solution summary. Tells the model to interview-then-plan: ask 1-2 clarifying questions, then propose a complete logic flow with nodes for opening hook, evidence beats, suspect interactions, the twist, and the accusation.",
    dynamicNotes:
      "Includes: project case brief · suspects roster · target document count · existing canvas (if any) · game language · player role.",
  },
  "generate-logic-flow:from-approved": {
    template:
      "Assembled in supabase/functions/generate-logic-flow/index.ts (line ~113) when the user already has an approved solution_summary. Tells the model to DECOMPOSE that approved story into canvas nodes/edges WITHOUT changing the mystery — preserve every approved beat verbatim.",
    dynamicNotes:
      "Includes: approved solution_summary · suspects · existing canvas nodes · target document count · game language.",
  },
  "explain-canvas-node": {
    template: `You are a senior mystery game designer explaining a single node in a case logic flow to the game's author. Be concrete and reference how this node connects to the wider solution. \${explanationLength} No fluff, no bullet lists unless genuinely needed.\n\nGAME-FLOW MODEL (critical when the node type is "envelope"): All evidence documents in this case live LOOSE in the box from the very start — the player has every document immediately. Envelopes are SEALED TASK GATES; they do NOT contain clues or documents. Each envelope holds only a short task / instruction / reveal the player reads when they reach a specific beat. The only exception is the final envelope (accusation form) and, very rarely, a single creative drop. When explaining an envelope node, never say it "contains" clues — instead explain (a) the task it gives the player, (b) which loose-pile clues the player should already be holding when they reach this gate, (c) the case beat that unlocks it, and (d) what it confirms or unlocks next.`,
    dynamicNotes:
      "\\${explanationLength} is replaced at runtime by your AI explanation length setting (Assistant rules). The user message also includes the full node payload, project brief, and connected nodes.",
  },
  "generate-document:doc0": {
    template: `You write Doc 0: a plain, player-facing box-contents inventory for a printable mystery game. Doc 0 is NOT in-world evidence. It is NOT a case memo. It is NOT styled like an aged document. Treat it as a clean printer-paper checklist.\n\nOUTPUT: ONLY a numbered list of every game document, one per line, in \${gameLanguage}, \${RTL-ready or properly formatted}. Format each line as exactly "<number>. <title>" — nothing else. No introduction, no headers beyond a single short title line, no envelope groupings, no descriptions, no flavor text, no realism details, no solution hints, no commentary about what each document does. Use the supplied Final Flow document nodes as the authoritative inventory. Do not invent documents that are not in the Final Flow.`,
    dynamicNotes:
      "\\${gameLanguage} comes from the project's Game Language setting. The user message includes the Final Documents Map inventory.",
  },
  "generate-document:text": {
    template: `You are a senior mystery-game writer producing one in-world evidence document for a premium printable detective game.\n\nCONTENT IS REASONED, NOT TEMPLATED. Read the case brief, the approved solution summary, the suspects, and the Logic Flow nodes this specific document is meant to support. Then write the document so it delivers ITS planned clue / role inside the case — not a generic example of its document type. The 'document type' field is ONLY a hint about FORMAT and visual style (interrogation transcript, autopsy report, letter, receipt, photograph caption, etc.). It is NOT a template for the body. Two documents of the same type in the same case must read very differently because the underlying evidence and characters are different.\n\nOUTPUT RULES:\n- Output ONLY the document body in \${gameLanguage}, \${RTL-ready or properly formatted}.\n- No meta-commentary, no disclaimers, no "[Note: ...]".\n- Stay in-world. Names, dates, locations, and details must be consistent with the case brief and Logic Flow.\n- Honor the document's planned purpose: the clue or piece of information it is supposed to surface for the player.\n- Do NOT reveal the full solution. Plant evidence; let the player deduce.\n- For interrogation transcripts: include pauses, body language, hesitations, contradictions, real back-and-forth.\n- Length and tone should match a real-world example of this document type, but the substance must come from THIS case.`,
    dynamicNotes:
      "The user message adds the case brief, approved solution summary, suspects, the planned clue/role this document delivers, and any design notes from the document row.",
  },
  "generate-envelopes": {
    template:
      "Assembled in supabase/functions/generate-envelopes/index.ts (line ~106). Instructs the model to design every sealed TASK envelope for the game in one JSON tool call — labels, opening triggers, tasks, and design instructions for each.",
    dynamicNotes:
      "Includes: envelope count · game language · project case brief · approved solution · suspects · final document inventory · existing envelopes (for edits) · envelope-settings playbook fragment.",
  },
  "generate-marketing-copy": {
    template: `You are a senior copywriter for premium boxed murder-mystery games. You write tight, evocative marketing copy. You return ONLY a JSON object — no preamble, no markdown fences. Keys must match the requested fields exactly.\n\n\${claudeSkillPromptBlock(enabledSkills, "marketing")}`,
    dynamicNotes:
      "\\${claudeSkillPromptBlock} expands to the prompt fragment for any Claude Skill enabled in the 'marketing' usage scope (Settings → Assistant rules → Claude Skills). The user message includes the case brief, suspects, tone notes, and the exact list of fields requested.",
  },
  "generate-storyboard:script": {
    template: `You are a trailer director for premium boxed murder-mystery games. You write tight, cinematic, dialogue-light shot lists. Output ONLY a JSON object with key "shots" — a flat array. No preamble, no markdown.\n\n\${claudeSkillPromptBlock(enabledSkills, "media")}`,
    dynamicNotes:
      "\\${claudeSkillPromptBlock} expands to any Claude Skill enabled for 'media'. The user message includes target length, case brief, tone, and any sora/kling instructions.",
  },
  "generate-storyboard:prompt": {
    template: `You write expert text-to-video prompts for \${engine}. Output ONLY the final prompt — no preamble, no quotes, no markdown. Be specific about subject, camera move, lens/focal length, lighting, palette, mood, era, and pacing for a single ~\${duration}s shot. NO scene-by-scene cuts.\n\n\${claudeSkillPromptBlock(enabledSkills, "media")}`,
    dynamicNotes:
      "\\${engine} is 'Sora' or 'Kling' depending on the picker. \\${duration} is the shot's seconds. The user message includes the shot description, project tone, and any engine-specific instructions.",
  },
  "suggest-image-prompt:cover": {
    template:
      "Assembled in supabase/functions/suggest-image-prompt/index.ts (line ~206) for `category = 'cover'`. Multi-section image brief covering subject, composition, palette, lighting, mood, and negative prompts — designed for a box-cover hero image.",
    dynamicNotes:
      "Includes: project case brief · suspects (for cast hints) · your global Image-prompt assistant instructions (Settings) · the project's own image_prompt_instructions · selected reference images.",
  },
  "suggest-image-prompt:suspect": {
    template:
      "Assembled in supabase/functions/suggest-image-prompt/index.ts (line ~206) for `category = 'suspect'`. Multi-section portrait brief for a single suspect — appearance, age, clothing, expression, environment, and lighting.",
    dynamicNotes:
      "Includes: that suspect's full row (name, role, summary, motives, secrets) · your global Image-prompt assistant instructions · the project's image_prompt_instructions · selected reference images · anchor portrait (if set).",
  },
  "suggest-image-prompt:document": {
    template:
      "Assembled in supabase/functions/suggest-image-prompt/index.ts (line ~206) for `category = 'document'`. Image brief for a document insert — paper stock, print era, staining, handwriting style, etc.",
    dynamicNotes:
      "Includes: the document row · the case beat it supports · your global Image-prompt assistant instructions · the project's image_prompt_instructions · selected reference images.",
  },
  "suggest-image-prompt:hint": {
    template:
      "Assembled in supabase/functions/suggest-image-prompt/index.ts (line ~206) for `category = 'hint'`. Image brief for a hint-sheet visual — usually a single evocative object or scene clue, no text.",
    dynamicNotes:
      "Includes: the hint stage and label · the case beat it gates · your global Image-prompt assistant instructions · the project's image_prompt_instructions · selected reference images.",
  },
  "suggest-image-prompt:media": {
    template:
      "Assembled in supabase/functions/suggest-image-prompt/index.ts (line ~206) for `category = 'media'`. Image brief for a media-library asset — broader than a document image, often used for marketing or in-world photography.",
    dynamicNotes:
      "Includes: the media row · your global Image-prompt assistant instructions · the project's image_prompt_instructions · selected reference images.",
  },
  "suggest-image-prompt:inline-image": {
    template:
      "Assembled in supabase/functions/suggest-image-prompt/index.ts (line ~404). Drives the per-slot CREATE PROMPT and FINAL PROMPT writers inside a document's inline images panel. Designed to riff off the slot's anchor reference image while staying consistent with the document's content.",
    dynamicNotes:
      "Includes: the document row · the inline-image slot's label and existing prompt history · the anchor reference URL · sibling slots in the same group · your global Image-prompt assistant instructions · the project's image_prompt_instructions.",
  },
  "suggest-image-prompt:legacy": {
    template:
      "Assembled in supabase/functions/suggest-image-prompt/index.ts (line ~513). Single-line image-prompt writer used by legacy code paths (covers, suspects, hints when called outside the structured path). Output is one prompt string, not a multi-section brief.",
    dynamicNotes:
      "Includes: your global Image-prompt assistant instructions · the project's image_prompt_instructions · target row context · selected reference images.",
  },
  "generate-document-inline-image": {
    template:
      "(Not yet wired to resolveSystemPrompt — the inline-image generator currently uses the suggest-image-prompt:inline-image surface for prompt-writing, then calls the image generator directly. Save an override on suggest-image-prompt:inline-image to control inline-image prompts.)",
    dynamicNotes: "—",
  },
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

async function getOwnerIdFromAuth(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
    const c = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data } = await c.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { surface } = await req.json().catch(() => ({}));
    if (!surface || typeof surface !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'surface' string" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const entry = DEFAULTS[surface];
    if (!entry) {
      return new Response(JSON.stringify({
        error: `Unknown surface: ${surface}`,
        knownSurfaces: Object.keys(DEFAULTS),
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ownerId = await getOwnerIdFromAuth(req);
    const resolved = await resolveSystemPrompt({
      ownerId,
      surface,
      defaultBody: entry.template,
    });

    return new Response(JSON.stringify({
      surface,
      defaultTemplate: entry.template,
      dynamicNotes: entry.dynamicNotes,
      assembledSystem: resolved.system,
      userHeader: resolved.userHeader,
      surfaceVersion: resolved.surfaceVersion,
      masterVersion: resolved.masterVersion,
      hasOverride: resolved.surfaceVersion !== null,
      hasMaster: resolved.masterVersion !== null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

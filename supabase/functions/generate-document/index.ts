// Generate Hebrew document content + optional image. Routes through the shared
// AI router so OpenAI / Anthropic / Gemini direct keys are used when configured.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, providerLabel, generateImage, ImageGenError } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

// Planning/document text models — see ai-router.ts for prefix routing rules.
const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-2.5-pro",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  openai: "openai/gpt-5",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "claude-haiku": "anthropic/claude-haiku-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentId, mode, imageModelOverride, quality: qualityOverride } = await req.json() as { documentId: string; mode: "text" | "image"; imageModelOverride?: string; quality?: "low" | "medium" | "high" };
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

    if (mode === "text") {
      const model = PROVIDER_MODEL[project?.ai_provider_documents ?? "lovable"] ?? PROVIDER_MODEL.lovable;
      const sys = `You write in-game evidence documents for premium printable Israeli mystery games. Output ONLY the document body in Hebrew, RTL-ready, realistic and immersive, tailored to the document type. No English. No meta-commentary. No disclaimers. For interrogation transcripts include pauses, body language and back-and-forth. Do not reveal the full solution.`;
      const userPrompt = `Case: ${project?.title ?? ""}\nPlayer role: ${project?.player_role ?? ""}\nCase goal: ${project?.case_goal ?? ""}\nYear: ${project?.year ?? ""}\nSetting: ${project?.setting ?? ""}\n\nDocument to produce:\nTitle: ${doc.title}\nType: ${doc.doc_type ?? "generic"}\nPrint size: ${doc.print_size ?? "A4"}\nDesign notes: ${doc.design_instructions ?? "—"}\n\nWrite the full Hebrew body now.`;

      const resp = await chatCompletions({
        model,
        messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
      });

      if (!resp.ok) {
        const provider = model.startsWith("openai/") ? "OpenAI"
          : model.startsWith("anthropic/") ? "Anthropic"
          : model.startsWith("gemini-direct/") ? "Google Gemini"
          : "Lovable AI";
        const t = await resp.text().catch(() => "");
        console.error(`${provider} text error`, resp.status, t);
        if (resp.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 402) return new Response(JSON.stringify({ error: `${provider} credits/key issue` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 401) return new Response(JSON.stringify({ error: `${provider} auth failed — check Settings → API keys` }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: `${provider} error (${resp.status})` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await resp.json();
      const hebrew = data.choices?.[0]?.message?.content ?? "";

      await supa.from("documents").update({ hebrew_content: hebrew, status: "review" }).eq("id", documentId);
      await supa.from("prompts").insert({
        project_id: doc.project_id,
        scope: "document",
        target_id: documentId,
        original_prompt: userPrompt,
        final_prompt: userPrompt,
        provider: providerLabel(model),
        model,
      });

      return new Response(JSON.stringify({ ok: true, hebrew_content: hebrew }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "image") {
      const { quality: qualityOverride } = (await Promise.resolve(null), {} as { quality?: string }); // placeholder, replaced below
      const imgPref = (imageModelOverride as string) || (project?.ai_provider_images as string) || "chatgpt-image-2";
      const model = IMAGE_MODEL[imgPref] ?? IMAGE_MODEL["chatgpt-image-2"];
      const useOpenAI = OPENAI_IMAGE_KEYS.has(imgPref);

      const designNotes = (doc.design_instructions ?? "").trim();
      const hebrewExcerpt = (doc.hebrew_content ?? "").trim().slice(0, 1200);
      const userImageInstructions = (project?.image_prompt_instructions as string ?? "").trim();

      const imgPrompt = [
        userImageInstructions
          ? `USER GLOBAL IMAGE INSTRUCTIONS (apply to every image in this project — highest priority):\n${userImageInstructions}\n`
          : "",
        `Create a single high-resolution, photorealistic, print-ready image of a ${doc.doc_type ?? "document"} for a premium Israeli mystery / detective game.`,
        `Game title: "${project?.title ?? ""}"${project?.subtitle ? ` — ${project.subtitle}` : ""}.`,
        `Era / setting: ${project?.year ?? "—"}, ${project?.setting ?? "Israeli setting"}.`,
        `Genre: ${project?.genre ?? "mystery"}. Mystery type: ${project?.mystery_type ?? "—"}.`,
        `Document title (visible if appropriate): "${doc.title}".`,
        `Final print size: ${doc.print_size ?? "A4"} — compose to that aspect ratio with safe margins.`,
        ``,
        `STRICT DESIGN & GRAPHIC INSTRUCTIONS (FOLLOW EVERY DETAIL — this is the primary brief):`,
        designNotes ? designNotes : `Authentic, period-correct, high-detail. Treat as a real-world physical prop: realistic paper texture, period-correct typography, believable headers/stamps/signatures.\n\nADDITIONAL REALISM DETAILS — include AT LEAST 20 concrete, period-appropriate details visible on the document. Pick from (and add similar): slight paper yellowing, faint horizontal fold across the center, mild edge wear, punch-hole marks on the left margin, one or two intake/filing stamps with era-correct date format, a typed reference number, a distribution list at the bottom, a small handwritten marginal note in pen or pencil, a signature scribble above a typed name, slightly uneven line spacing, faint photocopy shadowing along one edge, a classification stamp in dark red ink, a smaller box stamp near the lower third, a discreet fictitious seal (never a real emblem), a paperclip or staple shadow, a coffee/ink ring, smudged ribbon impression, carbon-copy bleed-through where applicable, a tape-repaired tear, a tiny fingerprint smudge, perforation marks if it's a tear-off form. Every detail must be concrete and visible — not a vague "looks aged".\n\nIf this document is an unusual / creative prop (map, diagram, hand-drawn note, cipher, blueprint, matchbook, ransom note, photo collage, evidence tag, ship/building map, etc.) instead include 8–15 CREATIVE in-world touches: hand annotations, torn-and-taped corners, smudged compass roses, coded margin doodles, crayon arrows, crossed-out misspellings, hidden symbols, unusual aspect ratios, attached Polaroids, etc. — tactile prop-style authenticity over bureaucratic realism.\n\nNo cartoon style. No watermark text. No copyright marks. No real emblems, real names, or real signatures.`,
        ``,
        `CONTENT TO RENDER (Hebrew, RTL, grammatically correct, fully legible):`,
        hebrewExcerpt ? hebrewExcerpt : "Use plausible Hebrew text appropriate to the document type. All Hebrew must be perfectly readable, properly kerned, and right-to-left.",
        ``,
        `RULES:`,
        `- Render as a real-world physical document photographed or scanned, not a UI mockup.`,
        `- All visible text must be in Hebrew unless the document type explicitly calls for another language (e.g. an English passport stamp).`,
        `- Do NOT include English placeholder text like "Lorem ipsum".`,
        `- Do NOT add modern watermarks, logos of real companies, or AI-generated artifacts.`,
        `- High dynamic range, sharp focus on the document, neutral lighting, color-accurate.`,
        `- Output ONE image only. Fill the frame with the document.`,
      ].filter(Boolean).join("\n");

      let mime = "image/png";
      let bytes: Uint8Array;

      if (useOpenAI) {
        if (!OPENAI_API_KEY) {
          return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Map print size → closest gpt-image-1 supported size
        const ps = (doc.print_size ?? "A4").toLowerCase();
        const portraitSizes = ["a3", "a4", "a5", "a6"];
        const size = portraitSizes.includes(ps) ? "1024x1536"
          : ps === "business card" ? "1536x1024"
          : "1024x1536";
        const oResp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: imgPrompt, size, quality: "high", n: 1 }),
        });
        if (!oResp.ok) {
          const t = await oResp.text();
          console.error("openai image error", oResp.status, t);
          if (oResp.status === 429) return new Response(JSON.stringify({ error: "OpenAI rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          return new Response(JSON.stringify({ error: "OpenAI image generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const oData = await oResp.json();
        const b64: string | undefined = oData.data?.[0]?.b64_json;
        if (!b64) return new Response(JSON.stringify({ error: "No image returned (OpenAI)" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        mime = "image/png";
      } else {
        try {
          const result = await generateImage({ prompt: imgPrompt, model });
          bytes = result.bytes;
          mime = result.mime;
        } catch (e) {
          if (e instanceof ImageGenError) {
            const provider = e.provider === "gemini-direct" ? "Google Gemini" : "Lovable AI";
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

      await supa.from("documents").update({ generated_asset_url: pub.publicUrl, active_version: "generated", status: "review" }).eq("id", documentId);
      await supa.from("prompts").insert({
        project_id: doc.project_id, scope: "document-image", target_id: documentId,
        original_prompt: imgPrompt, final_prompt: imgPrompt,
        provider: useOpenAI ? "openai" : (Deno.env.get("GEMINI_API_KEY") ? "gemini-direct" : "lovable-ai"),
        model,
      });

      return new Response(JSON.stringify({ ok: true, url: pub.publicUrl }), {
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

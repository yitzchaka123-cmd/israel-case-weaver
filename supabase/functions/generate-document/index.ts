// Generate Hebrew document content + optional image using Lovable AI Gateway
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-2.5-pro",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  openai: "openai/gpt-5",
  "openai-5.2": "openai/gpt-5.2",
  claude: "openai/gpt-5", // Claude not on gateway; falls back
};

// Image models. Default: Nano Banana 2 (Gemini 3.1 Flash Image — fast, pro-quality).
const IMAGE_MODEL: Record<string, string> = {
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
  "nano-banana": "google/gemini-2.5-flash-image",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentId, mode } = await req.json() as { documentId: string; mode: "text" | "image" };
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

      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }] }),
      });

      if (!resp.ok) {
        if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 402) return new Response(JSON.stringify({ error: "Out of credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: "Generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        provider: "lovable-ai",
        model,
      });

      return new Response(JSON.stringify({ ok: true, hebrew_content: hebrew }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "image") {
      const imgPref = (project?.ai_provider_images as string) ?? "nano-banana-2";
      const model = IMAGE_MODEL[imgPref] ?? IMAGE_MODEL["nano-banana-2"];

      const designNotes = (doc.design_instructions ?? "").trim();
      const hebrewExcerpt = (doc.hebrew_content ?? "").trim().slice(0, 1200);

      const imgPrompt = [
        `Create a single high-resolution, photorealistic, print-ready image of a ${doc.doc_type ?? "document"} for a premium Israeli mystery / detective game.`,
        `Game title: "${project?.title ?? ""}"${project?.subtitle ? ` — ${project.subtitle}` : ""}.`,
        `Era / setting: ${project?.year ?? "—"}, ${project?.setting ?? "Israeli setting"}.`,
        `Genre: ${project?.genre ?? "mystery"}. Mystery type: ${project?.mystery_type ?? "—"}.`,
        `Document title (visible if appropriate): "${doc.title}".`,
        `Final print size: ${doc.print_size ?? "A4"} — compose to that aspect ratio with safe margins.`,
        ``,
        `STRICT DESIGN & GRAPHIC INSTRUCTIONS (FOLLOW EVERY DETAIL — this is the primary brief):`,
        designNotes ? designNotes : "Authentic, period-correct, high-detail. Realistic paper texture; aged, slightly worn where appropriate. Believable typography for the document type. Realistic stamps, signatures, headers, logos, watermarks, perforations, paperclips, coffee stains, fold lines or staples where they would naturally appear. No cartoon style. No watermark text. No copyright marks.",
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
      ].join("\n");

      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: imgPrompt }], modalities: ["image", "text"] }),
      });

      if (!resp.ok) {
        if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 402) return new Response(JSON.stringify({ error: "Out of credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: "Image generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await resp.json();
      const imageUrl: string | undefined = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      const m = imageUrl?.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return new Response(JSON.stringify({ error: "No image returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const mime = m[1];
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      const ext = mime.split("/")[1] ?? "png";
      const path = `${doc.project_id}/${documentId}-${Date.now()}.${ext}`;
      await supa.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: true });
      const { data: pub } = supa.storage.from("documents").getPublicUrl(path);

      await supa.from("documents").update({ generated_asset_url: pub.publicUrl, active_version: "generated", status: "review" }).eq("id", documentId);
      await supa.from("prompts").insert({
        project_id: doc.project_id, scope: "document-image", target_id: documentId,
        original_prompt: imgPrompt, final_prompt: imgPrompt, provider: "lovable-ai", model,
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

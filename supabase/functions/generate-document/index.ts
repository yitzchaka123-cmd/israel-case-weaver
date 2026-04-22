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
  openai: "openai/gpt-5",
  claude: "openai/gpt-5",
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
      const model = "google/gemini-2.5-flash-image";
      const imgPrompt = `Realistic, print-ready ${doc.doc_type ?? "document"} for a premium Israeli mystery game titled "${project?.title ?? ""}". Final print size: ${doc.print_size ?? "A4"}. Design: ${doc.design_instructions ?? "authentic, high-detail, aged paper where appropriate"}. Title: ${doc.title}. Content in Hebrew where visible text is needed. High-resolution, lifelike, professional.`;

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

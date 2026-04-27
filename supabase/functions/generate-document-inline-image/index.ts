// Per-slot inline image generation for documents-with-pictures.
//
// Anchor-aware: when the slot is a child of an anchor (anchor_image_id set),
// the prompt is built around the anchor's prompt (consistency lock) AND we
// pass the anchor's image URL as a reference image to Gemini Nano Banana via
// the chat-completions image-edit shape. OpenAI's image-generation API does
// not accept reference images on this route, so for OpenAI children we fall
// back to a text-only consistency prompt (still useful, just weaker).
//
// Writes to public.document_inline_images (status, url, model, etc.) and
// appends a media_assets row for history/origin badges.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateImage, ImageGenError, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { buildInlineImagePrompt } from "../_shared/inline-image-prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_API_KEY_IMAGE2 = Deno.env.get("OPENAI_IMAGE2_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const IMAGE_MODEL: Record<string, string> = {
  "chatgpt-image-2": "gpt-image-2",
  "chatgpt-image": "gpt-image-1",
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
  "nano-banana": "google/gemini-2.5-flash-image",
};
const OPENAI_KEYS = new Set(["chatgpt-image-2", "chatgpt-image"]);

interface Body {
  inlineImageId: string;
  modelOverride?: string;
}

interface SlotRow {
  id: string;
  document_id: string;
  project_id: string;
  position: number;
  slot_label: string;
  prompt: string | null;
  url: string | null;
  is_anchor: boolean;
  anchor_image_id: string | null;
  group_key: string | null;
}

// Edit an image via Gemini direct using a reference image URL. Returns bytes.
async function geminiEditWithReference(opts: {
  prompt: string;
  refImageUrl: string;
  model: string;
}): Promise<{ bytes: Uint8Array; mime: string }> {
  // Fetch the reference image and base64-encode it.
  const refResp = await fetch(opts.refImageUrl);
  if (!refResp.ok) throw new ImageGenError(`Could not fetch anchor image (${refResp.status})`, refResp.status, "gemini-direct");
  const refBytes = new Uint8Array(await refResp.arrayBuffer());
  const refMime = refResp.headers.get("content-type") ?? "image/png";
  let refB64 = "";
  // Chunked to avoid call-stack overflow on large arrays.
  const CHUNK = 0x8000;
  for (let i = 0; i < refBytes.length; i += CHUNK) {
    refB64 += String.fromCharCode(...refBytes.subarray(i, i + CHUNK));
  }
  refB64 = btoa(refB64);

  if (GEMINI_API_KEY) {
    const directModel = opts.model.startsWith("google/") ? opts.model.slice("google/".length) : opts.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(directModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: opts.prompt },
            { inlineData: { mimeType: refMime, data: refB64 } },
          ],
        }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new ImageGenError(`Gemini direct edit error ${r.status}: ${t}`, r.status, "gemini-direct");
    }
    const data = await r.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data);
    if (!inline?.inlineData?.data) throw new ImageGenError("No image returned (Gemini direct edit)", 500, "gemini-direct");
    return {
      bytes: Uint8Array.from(atob(inline.inlineData.data), (c) => c.charCodeAt(0)),
      mime: inline.inlineData.mimeType ?? "image/png",
    };
  }

  // Fallback: Lovable AI Gateway, chat-completions image edit shape.
  if (!LOVABLE_API_KEY) throw new ImageGenError("No image provider configured for reference-image edits", 401, "lovable-ai");
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: opts.prompt },
          { type: "image_url", image_url: { url: `data:${refMime};base64,${refB64}` } },
        ],
      }],
      modalities: ["image", "text"],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new ImageGenError(`Lovable gateway edit error ${r.status}: ${t}`, r.status, "lovable-ai");
  }
  const data = await r.json();
  const dataUrl: string | undefined = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl) throw new ImageGenError("No image returned (Lovable gateway edit)", 500, "lovable-ai");
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new ImageGenError("Malformed image data URL from gateway", 500, "lovable-ai");
  return {
    bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)),
    mime: m[1],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  let userId: string | null = null;
  let projectIdLog: string | null = null;
  let modelLog = "";

  try {
    userId = await getUserIdFromAuth(req);
    const { inlineImageId, modelOverride } = await req.json() as Body;
    if (!inlineImageId) {
      return new Response(JSON.stringify({ error: "inlineImageId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);

    const { data: slot, error: slotErr } = await supa
      .from("document_inline_images")
      .select("*")
      .eq("id", inlineImageId)
      .single();
    if (slotErr || !slot) {
      return new Response(JSON.stringify({ error: "Slot not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const row = slot as SlotRow;
    projectIdLog = row.project_id;

    const { data: doc } = await supa
      .from("documents")
      .select("title, doc_type, design_instructions, inline_images_caption")
      .eq("id", row.document_id)
      .single();

    const { data: project } = await supa
      .from("projects")
      .select("ai_provider_images, image_prompt_instructions")
      .eq("id", row.project_id)
      .single();

    // Resolve anchor row + sibling slots (for context).
    // Prefer anchor_reference_url (the locked first-generated reference) over
    // the active url, so the user picking a different "final" image from the
    // anchor's history reel never breaks sibling consistency.
    let anchor: { slot_label: string; prompt: string | null; url: string | null } | null = null;
    if (row.anchor_image_id) {
      const { data: a } = await supa
        .from("document_inline_images")
        .select("slot_label, prompt, url, anchor_reference_url")
        .eq("id", row.anchor_image_id)
        .maybeSingle();
      const lockedUrl = (a as { anchor_reference_url?: string | null } | null)?.anchor_reference_url ?? a?.url ?? null;
      if (a && lockedUrl) anchor = { slot_label: a.slot_label, prompt: a.prompt, url: lockedUrl };
      // If the anchor hasn't been generated yet, treat THIS as a stand-alone
      // generation (don't try to lock to a non-existent reference).
    }
    const { data: siblings } = row.group_key
      ? await supa
          .from("document_inline_images")
          .select("slot_label, prompt, position, group_key")
          .eq("document_id", row.document_id)
          .eq("group_key", row.group_key)
          .neq("id", row.id)
          .order("position", { ascending: true })
      : { data: [] };

    const finalPrompt = buildInlineImagePrompt({
      doc: {
        title: doc?.title ?? "Document",
        doc_type: doc?.doc_type ?? null,
        design_instructions: doc?.design_instructions ?? null,
        inline_images_caption: doc?.inline_images_caption ?? null,
      },
      thisImage: {
        slot_label: row.slot_label,
        prompt: row.prompt,
        position: row.position,
        group_key: row.group_key,
      },
      anchor,
      groupSiblings: (siblings ?? []) as Array<{ slot_label: string; prompt: string | null; position: number; group_key: string | null }>,
      projectImageStyle: String(project?.image_prompt_instructions ?? ""),
    });

    const pref = (modelOverride || (project?.ai_provider_images as string) || "nano-banana-pro");
    const model = IMAGE_MODEL[pref] ?? IMAGE_MODEL["nano-banana-pro"];
    modelLog = model;
    const useOpenAI = OPENAI_KEYS.has(pref);

    // Mark generating.
    await supa.from("document_inline_images").update({ status: "generating", error_message: null } as never).eq("id", row.id);

    let bytes: Uint8Array;
    let mime = "image/png";
    let providerLabel: "openai-direct" | "openai-image2" | "gemini-direct" | "lovable-ai" = "lovable-ai";

    try {
      if (anchor && anchor.url && !useOpenAI) {
        // Reference-image edit path (Gemini family). Strongest consistency.
        const result = await geminiEditWithReference({ prompt: finalPrompt, refImageUrl: anchor.url, model });
        bytes = result.bytes;
        mime = result.mime;
        providerLabel = GEMINI_API_KEY ? "gemini-direct" : "lovable-ai";
      } else if (useOpenAI) {
        // OpenAI text-to-image path (no reference image — consistency relies
        // on the anchor's prompt baked into the text by buildInlineImagePrompt).
        const key = (pref === "chatgpt-image-2" && OPENAI_API_KEY_IMAGE2) ? OPENAI_API_KEY_IMAGE2 : OPENAI_API_KEY;
        if (!key) throw new Error("OpenAI API key not configured");
        const oResp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model, prompt: finalPrompt, size: "1024x1024", quality: "medium", n: 1,
            output_format: "jpeg", output_compression: 90,
            ...(model === "gpt-image-2" ? { moderation: "low" } : {}),
          }),
        });
        if (!oResp.ok) {
          const t = await oResp.text();
          throw new Error(`OpenAI ${oResp.status}: ${t.slice(0, 300)}`);
        }
        const oData = await oResp.json();
        const b64: string | undefined = oData.data?.[0]?.b64_json;
        if (!b64) throw new Error("No image returned (OpenAI)");
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        mime = "image/jpeg";
        providerLabel = (pref === "chatgpt-image-2" && OPENAI_API_KEY_IMAGE2) ? "openai-image2" : "openai-direct";
      } else {
        // Plain text-to-image (Gemini family). Used for the anchor itself or
        // when no reference is available.
        const result = await generateImage({ prompt: finalPrompt, model });
        bytes = result.bytes;
        mime = result.mime;
        providerLabel = result.provider;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Inline image generation failed";
      await supa.from("document_inline_images").update({ status: "failed", error_message: msg } as never).eq("id", row.id);
      await logAiRun({
        userId, projectId: projectIdLog, surface: "generate-document-inline-image",
        requestedModel: model, status: "error", errorMessage: msg.slice(0, 500),
        latencyMs: Date.now() - startedAt, targetId: row.id, promptExcerpt: finalPrompt,
      });
      return new Response(JSON.stringify({ error: msg }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ext = mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "png");
    const path = `${row.project_id}/inline/${row.document_id}-${row.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supa.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) {
      await supa.from("document_inline_images").update({ status: "failed", error_message: upErr.message } as never).eq("id", row.id);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pub } = supa.storage.from("documents").getPublicUrl(path);

    // Append history (push old url onto url_history) and persist new state.
    const priorUrlHistory = Array.isArray((row as unknown as { url_history?: unknown[] }).url_history)
      ? (row as unknown as { url_history: unknown[] }).url_history
      : [];
    const priorPromptHistory = Array.isArray((row as unknown as { prompt_history?: unknown[] }).prompt_history)
      ? (row as unknown as { prompt_history: unknown[] }).prompt_history
      : [];
    const newUrlHist = row.url
      ? [{ at: new Date().toISOString(), url: row.url, model: (row as unknown as { effective_model?: string }).effective_model ?? null }, ...priorUrlHistory].slice(0, 20)
      : priorUrlHistory;
    const newPromptHist = row.prompt
      ? [{ at: new Date().toISOString(), prompt: row.prompt }, ...priorPromptHistory].slice(0, 20)
      : priorPromptHistory;

    await supa.from("document_inline_images").update({
      url: pub.publicUrl,
      active_version: "generated",
      provider: providerLabel,
      model,
      effective_model: model,
      fallback: "none",
      status: "generated",
      error_message: null,
      url_history: newUrlHist,
      prompt_history: newPromptHist,
    } as never).eq("id", row.id);

    // History/origin entry in media_assets so the existing AI-origin badges
    // and admin views light up for inline images too.
    await supa.from("media_assets").insert({
      project_id: row.project_id,
      category: "document-inline",
      title: `${doc?.title ?? "Document"} — ${row.slot_label}`,
      url: pub.publicUrl,
      mime_type: mime,
      prompt: finalPrompt,
      provider: providerLabel,
      model,
      effective_model: model,
      asset_type: "image",
      source_document_id: row.document_id,
      generation_mode: anchor ? "inline_image_anchor_variation" : "inline_image_generation",
      status: "generated",
    } as never);

    await logAiRun({
      userId, projectId: projectIdLog, surface: "generate-document-inline-image",
      requestedModel: model, effectiveModel: model, fallback: "none",
      status: "ok", latencyMs: Date.now() - startedAt,
      targetId: row.id, promptExcerpt: finalPrompt,
    });

    return new Response(JSON.stringify({
      ok: true,
      url: pub.publicUrl,
      model,
      provider: providerLabel,
      anchored: !!anchor,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logAiRun({
      userId, projectId: projectIdLog, surface: "generate-document-inline-image",
      requestedModel: modelLog, status: "error", errorMessage: msg.slice(0, 500),
      latencyMs: Date.now() - startedAt,
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Generate visually-consistent A4 page-insert images for a SET of envelopes
// in one call (sequential per envelope, with the first generated image used
// as the anchor reference for #2..N). Mirrors generate-consistent-document-images
// but writes to the `envelopes` table and uses envelope page-insert prompting.
//
// Always uses OpenAI gpt-image-2 (the only model that accepts multi-image
// input refs). The final envelope (with QR card) is included with its own
// per-envelope prompt suffix so its bottom 35% renders the framed QR card
// while still inheriting the anchor's paper/typography/era.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_API_KEY_IMAGE2 = Deno.env.get("OPENAI_IMAGE2_API_KEY") ?? "";

interface Body {
  projectId: string;
  envelopeIds: string[];
  quality?: "low" | "medium" | "high";
  setBriefOverride?: string;
}

interface EnvelopeRow {
  id: string;
  project_id: string;
  number: number;
  label: string | null;
  task: string | null;
  design_instructions: string | null;
  solution_video_url: string | null;
}

async function fetchAsBlob(url: string): Promise<{ blob: Blob; filename: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const mime = r.headers.get("content-type") ?? "image/png";
    const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
    return { blob: new Blob([buf], { type: mime }), filename: `ref-${crypto.randomUUID()}.${ext}` };
  } catch {
    return null;
  }
}

function pickKey(): string {
  return OPENAI_API_KEY_IMAGE2 || OPENAI_API_KEY;
}

function buildSetBrief(envs: EnvelopeRow[], userOverride: string | undefined): string {
  return [
    `CONSISTENT-SET RENDER — you are producing one of ${envs.length} A4 page-insert images that MUST share an identical visual world.`,
    `These pages are sealed-envelope inserts in a physical mystery game. Each page is photographed top-down, lying flat on a neutral surface, filling the frame in portrait.`,
    ``,
    `LOCKED VISUAL PROPERTIES — every image in this set MUST share these exactly:`,
    `- Paper stock, color, grain, texture, edge wear, and aging.`,
    `- Header/letterhead style, agency / sender treatment, file-number boxes, classification stamps if any.`,
    `- Typography: identical fonts, sizes, weights, line spacing, label styles.`,
    `- Color palette and ink color (same blue/black/red, same stamp colors).`,
    `- Camera/scan look: same angle, same lighting, same shadow, same bleed.`,
    `- Era and tone: same period, same world, same authoring voice.`,
    ``,
    `VARY ONLY:`,
    `- The body copy of each page (provided per-envelope below).`,
    `- The single bold red "Your task" line (per-envelope) — except on the FINAL envelope which has a QR card instead.`,
    `- Per-envelope marker / number.`,
    ``,
    `Rules that apply to EVERY page in the set:`,
    `- This is a PAGE, not an envelope. No envelopes, flaps, wax seals, kraft mailers, manila sleeves, postage anywhere.`,
    `- Render ONLY tactile details described per-envelope below. Do not invent generic coffee stains, fold lines, binder holes, fax noise, redaction tape unless explicitly called for.`,
    `- Page must read as a FULL A4 sheet — generous body text, smart spacing, no half-empty pages.`,
    userOverride?.trim() ? `\nADDITIONAL USER STYLE NOTES:\n${userOverride.trim()}` : "",
  ].filter(Boolean).join("\n");
}

function buildPerEnvelopePrompt(opts: {
  setBrief: string;
  env: EnvelopeRow;
  index: number;
  total: number;
  hasAnchor: boolean;
  isFinal: boolean;
}): string {
  const { setBrief, env, index, total, hasAnchor, isFinal } = opts;
  const compact = (env.design_instructions ?? "").replace(/\s+/g, " ").trim().slice(0, 3200);
  const lines = [
    setBrief,
    ``,
    `THIS IMAGE IS PAGE ${index + 1} OF ${total} IN THE SET.`,
    hasAnchor
      ? `The attached reference image is the ANCHOR (page #1 already generated). Match its paper, header, typography, ink, lighting, and overall look EXACTLY. Treat the form as a stationery template filled in differently here — NOT a fresh design.`
      : `This is the ANCHOR (first page of the set). Commit to a strong, opinionated visual template — every later page in this set will inherit your paper, header, fonts, and stamp design.`,
    ``,
    `Page marker / slot: ${env.number}.`,
  ];
  if (!isFinal) {
    lines.push(
      `Red task line: the 'Your task:' sentence must be printed as a SINGLE BOLD RED LINE on its own line, visually unmistakable (period-appropriate equivalents are fine: red typewriter ribbon, red rubber stamp, red marker underline).`,
    );
  } else {
    lines.push(
      `Final envelope QR CARD: reserve the BOTTOM ~35% of the A4 page for a single LARGE FRAMED QR CARD — not a small inline graphic. STRUCTURE (locked): a clearly bordered card containing, top-to-bottom: a short bold label in the game language (equivalent of 'Official News Report'), then a believable printed black-and-white QR square roughly 5×5 cm centered inside the frame, then a short helper line directly under the QR (equivalent of 'Scan to watch'), then the URL printed in small monospace type as a fallback. The card must inherit the paper texture, border treatment, label typography, and any tape/stamp/seal accents from the anchor — do NOT default to a generic modern frame.`,
    );
    if (env.solution_video_url) {
      lines.push(`QR card URL fallback (PRINT this URL beneath the helper line in small monospace type): ${env.solution_video_url.slice(0, 200)}`);
    }
  }
  lines.push(``, `DESIGN BRIEF for this page:`, compact || "(no design brief)");
  return lines.join("\n");
}

async function callOpenAiEdit(opts: {
  prompt: string;
  refImages: Array<{ blob: Blob; filename: string }>;
  quality: "low" | "medium" | "high";
}): Promise<{ bytes: Uint8Array; mime: string }> {
  const key = pickKey();
  if (!key) throw new Error("OpenAI API key not configured");
  const fd = new FormData();
  fd.set("model", "gpt-image-2");
  fd.set("prompt", opts.prompt);
  fd.set("size", "1024x1536");
  fd.set("quality", opts.quality);
  fd.set("n", "1");
  fd.set("output_format", "jpeg");
  fd.set("output_compression", "90");
  for (const ref of opts.refImages) {
    fd.append("image[]", ref.blob, ref.filename);
  }
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t;
    try { msg = JSON.parse(t)?.error?.message ?? t; } catch { /* */ }
    throw new Error(`OpenAI ${r.status}: ${msg.slice(0, 400)}`);
  }
  const data = await r.json();
  const b64: string | undefined = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned (consistent envelope set)");
  return {
    bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    mime: "image/jpeg",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const envelopeIds = Array.isArray(body.envelopeIds) ? body.envelopeIds.filter((s) => typeof s === "string") : [];
    if (!body.projectId || envelopeIds.length < 2) {
      return new Response(JSON.stringify({ error: "Provide projectId and at least 2 envelopeIds." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (envelopeIds.length > 10) {
      return new Response(JSON.stringify({ error: "Max 10 envelopes per consistent set call." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const quality: "low" | "medium" | "high" = body.quality === "high" || body.quality === "low" ? body.quality : "medium";

    const supa = createClient(SUPABASE_URL, SERVICE);

    const { data: envs, error } = await supa
      .from("envelopes")
      .select("id, project_id, number, label, task, design_instructions, solution_video_url")
      .in("id", envelopeIds)
      .eq("project_id", body.projectId);
    if (error || !envs || envs.length === 0) {
      return new Response(JSON.stringify({ error: error?.message ?? "Envelopes not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine which is "final" = highest number among ALL envelopes in the project.
    const { data: allEnvs } = await supa
      .from("envelopes")
      .select("number")
      .eq("project_id", body.projectId);
    const finalNumber = (allEnvs ?? []).reduce((m, r: { number: number }) => Math.max(m, r.number ?? 0), 0);

    // Order by envelope number ascending so the first non-final envelope becomes the anchor.
    const sorted = (envs as EnvelopeRow[]).slice().sort((a, b) => a.number - b.number);
    // Move the final envelope to last (so it inherits anchor style).
    const nonFinal = sorted.filter((e) => e.number !== finalNumber);
    const finalE = sorted.find((e) => e.number === finalNumber);
    const ordered: EnvelopeRow[] = finalE ? [...nonFinal, finalE] : nonFinal;
    if (ordered.length < 2) {
      return new Response(JSON.stringify({ error: "Need at least 2 envelopes after ordering." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const setBrief = buildSetBrief(ordered, body.setBriefOverride);

    const runJob = async () => {
      let liveAnchor: string | null = null;
      for (let i = 0; i < ordered.length; i += 1) {
        const env = ordered[i];
        const isFinal = env.number === finalNumber;
        const refs: Array<{ blob: Blob; filename: string }> = [];
        if (liveAnchor) {
          const a = await fetchAsBlob(liveAnchor);
          if (a) refs.push(a);
        }
        if (refs.length === 0) {
          const blank = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
          refs.push({ blob: new Blob([blank], { type: "image/png" }), filename: "blank.png" });
        }
        const prompt = buildPerEnvelopePrompt({
          setBrief, env, index: i, total: ordered.length, hasAnchor: Boolean(liveAnchor), isFinal,
        });

        try {
          const { bytes, mime } = await callOpenAiEdit({ prompt, refImages: refs, quality });
          const path = `${env.project_id}/envelopes/consistent/${env.id}-${Date.now()}.jpg`;
          await supa.storage.from("covers").upload(path, bytes, { contentType: mime, upsert: true });
          const { data: pub } = supa.storage.from("covers").getPublicUrl(path);
          const url = pub.publicUrl;
          if (i === 0) liveAnchor = url;

          await supa.from("envelopes").update({
            cover_image_url: url,
            status: "review",
            cover_prompt: prompt,
            cover_effective_model: "gpt-image-2",
            cover_fallback: "none",
          } as never).eq("id", env.id);

          await supa.from("media_assets").insert({
            project_id: env.project_id,
            category: "envelope",
            title: `Envelope ${env.number} — consistent set`,
            url,
            mime_type: mime,
            prompt,
            provider: "openai-image2",
            model: "gpt-image-2",
            effective_model: "gpt-image-2",
            asset_type: "image",
            source_envelope_id: env.id,
            generation_mode: "consistent_set",
            status: "generated",
          } as never);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error(`consistent-envelope ${env.id} failed:`, msg);
        }
      }
    };

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(runJob());
    } else {
      runJob().catch((e) => console.error("consistent envelope job error:", e));
    }

    return new Response(JSON.stringify({
      ok: true, queued: true, envelopeIds: ordered.map((e) => e.id),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

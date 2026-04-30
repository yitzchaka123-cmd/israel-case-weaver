// Bulk document generation orchestrator.
//
// Walks a list of documents and calls the existing `generate-document` edge
// function once per (doc, requested-output) tuple, with a small concurrency
// window (defaults to SERIAL = 1 so the user sees one shot at a time).
// Writes live progress + a heartbeat to `bulk_generation_jobs` so the UI can
// show "12 / 40 · current: …" with realtime updates and detect a crashed
// worker, AND emits one `project_notifications` row per doc as it finishes
// (with a thumbnail when an image was produced) so the bell shows live
// per-doc updates.
//
// Reliability:
//   - Background work runs via `globalThis.EdgeRuntime.waitUntil(...)` so the
//     platform keeps the worker alive after the HTTP response returns.
//   - The whole worker body is wrapped in try/catch/finally — the job row
//     ALWAYS transitions out of `running` even on a crash.
//   - Every doc tick (and every long sleep) writes `last_heartbeat_at = now()`.
//   - Between docs the worker checks `cancel_requested` and exits cleanly.
//   - At kickoff, any other `running` jobs for the same project that haven't
//     beat in 4 minutes are auto-closed (sweep), so a previous ghost can
//     never block the next run.
//
// Modes / Scopes / `waitForJobId` / 429-402 retry: unchanged from before.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Mode = "draft" | "image" | "document" | "both" | "image_to_pdf";
type Scope = "all_remaining" | "from_doc_number" | "ids";

interface BulkRequest {
  projectId: string;
  scope: Scope;
  mode: Mode;
  documentFormat?: "pdf" | "docx" | "pptx" | "xlsx";
  fromDocNumber?: number;
  untilDocNumber?: number;
  documentIds?: string[];
  concurrency?: number;
  waitForJobId?: string | null;
  /**
   * When true (default), docs that already have content for the chosen mode
   * are skipped:
   *   - draft     → skip if hebrew_content is non-empty
   *   - image     → skip if generated_asset_url is set
   *   - document  → skip if generated_document_url or generated_pdf_url is set
   *   - both      → skip if BOTH image and file exist
   * When false, every doc in scope is regenerated (overwrite).
   */
  skipExisting?: boolean;
  /**
   * When true, after the run finishes the worker inserts a
   * "bulk_generation_done" notification with a starter_prompt so the
   * assistant follow-up flow kicks in. Default true.
   */
  notifyOnComplete?: boolean;
  /** Optional image quality override forwarded to generate-document. */
  imageQuality?: "low" | "medium" | "high" | "auto";
  /** Optional image model override forwarded to generate-document. */
  imageModel?: string;
}

const MAX_CONCURRENCY = 5;
/** Hard ceiling for a single bulk run, to bound runaway loops. */
const HARD_TIMEOUT_MS = 25 * 60_000;
/** A job is considered stale (worker dead) after this long without a heartbeat. */
const STALE_MINUTES = 4;

async function callGenerateDocument(
  documentId: string,
  mode: "text" | "image" | "document" | "image_to_pdf",
  documentFormat: string,
  signal: AbortSignal,
  imageQuality?: string,
  imageModel?: string,
) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      documentId,
      mode,
      documentFormat,
      ...(imageQuality ? { imageQuality } : {}),
      ...(imageModel ? { imageModel } : {}),
    }),
    signal,
  });
  let body: any = {};
  try { body = await r.json(); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, body };
}

async function beat(supa: any, jobId: string, patch: Record<string, unknown> = {}) {
  try {
    await supa.from("bulk_generation_jobs").update({
      last_heartbeat_at: new Date().toISOString(),
      ...patch,
    }).eq("id", jobId);
  } catch (e) {
    console.warn("[bulk] heartbeat failed", e);
  }
}

async function isCancelled(supa: any, jobId: string): Promise<boolean> {
  try {
    const { data } = await supa.from("bulk_generation_jobs").select("cancel_requested").eq("id", jobId).maybeSingle();
    return !!(data as { cancel_requested?: boolean } | null)?.cancel_requested;
  } catch { return false; }
}

async function generateOneDoc(
  supa: any,
  jobId: string,
  doc: { id: string; title: string },
  mode: Mode,
  documentFormat: string,
  imageQuality?: string,
  imageModel?: string,
): Promise<{ ok: boolean; error?: string }> {
  await beat(supa, jobId, { current_doc_id: doc.id, current_doc_title: doc.title });

  const steps: ("text" | "image" | "document" | "image_to_pdf")[] =
    mode === "draft" ? ["text"] :
    mode === "image" ? ["image"] :
    mode === "document" ? ["document"] :
    mode === "image_to_pdf" ? ["image_to_pdf"] :
    /* both */ ["image", "document"];

  for (const step of steps) {
    let attempt = 0;
    while (true) {
      attempt++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180_000);
      try {
        const r = await callGenerateDocument(doc.id, step, documentFormat, ctrl.signal, imageQuality, imageModel);
        clearTimeout(timer);
        if (r.ok) break;
        // Retry on rate limit / credits — beat during the long sleep too.
        if ((r.status === 429 || r.status === 402) && attempt <= 3) {
          console.warn(`[bulk] ${step} for ${doc.id} hit ${r.status}, sleeping 30s (attempt ${attempt}/3)`);
          for (let i = 0; i < 6; i++) {
            await new Promise((res) => setTimeout(res, 5_000));
            await beat(supa, jobId);
          }
          continue;
        }
        const err = (r.body?.error as string) ?? `HTTP ${r.status}`;
        return { ok: false, error: `${step}: ${err}` };
      } catch (e) {
        clearTimeout(timer);
        const aborted = (e as Error)?.name === "AbortError";
        if (aborted && attempt <= 2) continue;
        return { ok: false, error: `${step}: ${aborted ? "timeout" : (e as Error).message}` };
      }
    }
  }
  return { ok: true };
}

/** Insert a per-doc notification (success or failure) AND record the error on the doc itself. */
async function notifyPerDoc(
  supa: any,
  projectId: string,
  doc: { id: string; title: string; doc_number: number | null },
  mode: Mode,
  outcome: { ok: boolean; error?: string },
) {
  try {
    // Persist last error on the doc so the Documents table can show a red dot.
    try {
      await supa.from("documents").update({
        last_generation_error: outcome.ok ? null : (outcome.error ?? "Generation failed").slice(0, 500),
      }).eq("id", doc.id);
    } catch (_e) { /* non-fatal */ }

    const numLabel = doc.doc_number !== null && doc.doc_number !== undefined ? `Doc ${doc.doc_number}` : "Doc";
    let previewUrl: string | null = null;
    if (outcome.ok && mode !== "draft") {
      const { data } = await supa
        .from("documents")
        .select("generated_asset_url, document_preview_url")
        .eq("id", doc.id)
        .single();
      previewUrl = (data?.document_preview_url as string | null) ?? (data?.generated_asset_url as string | null) ?? null;
    }
    const verb =
      mode === "draft" ? "Drafted"
      : mode === "image" ? "Image generated for"
      : mode === "document" ? "File generated for"
      : mode === "image_to_pdf" ? "PDF wrapped for"
      : "Generated";
    const title = outcome.ok
      ? `✓ ${numLabel} — ${doc.title}`
      : `⚠ ${numLabel} — ${doc.title} failed`;
    const body = outcome.ok
      ? `${verb} "${doc.title}".`
      : (outcome.error ?? "Generation failed").slice(0, 280);
    await supa.from("project_notifications").insert({
      project_id: projectId,
      kind: outcome.ok ? "bulk_doc_done" : "bulk_doc_failed",
      title,
      body,
      preview_image_url: previewUrl,
      created_by: "assistant",
      status: "unread",
    } as never);
  } catch (e) {
    console.warn("[bulk] per-doc notification failed", e);
  }
}

/** Wait for a prior job to reach a terminal state. Polls every 5s, max 20 min. */
async function waitForPriorJob(supa: any, priorJobId: string) {
  const start = Date.now();
  const deadline = start + 20 * 60_000;
  while (Date.now() < deadline) {
    const { data } = await supa
      .from("bulk_generation_jobs")
      .select("status")
      .eq("id", priorJobId)
      .maybeSingle();
    const s = (data as { status?: string } | null)?.status;
    if (!s) return;
    if (s === "completed" || s === "failed") return;
    await new Promise((res) => setTimeout(res, 5_000));
  }
  console.warn(`[bulk] waitForJobId ${priorJobId} timed out — proceeding anyway`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const input = await req.json() as BulkRequest;
    const { projectId, scope, mode } = input;
    if (!projectId || !scope || !mode) {
      return new Response(JSON.stringify({ error: "projectId, scope, mode required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const documentFormat = input.documentFormat ?? "pdf";
    const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, input.concurrency ?? 1));
    const notifyOnComplete = input.notifyOnComplete !== false;

    const supa = createClient(SUPABASE_URL, SERVICE);

    // Pre-flight: sweep stale ghost jobs across the project so we never get
    // blocked by a previous crashed worker.
    try {
      const { data: swept } = await supa.rpc("sweep_stale_bulk_jobs", { p_project_id: projectId, p_stale_minutes: STALE_MINUTES });
      if (swept && (swept as number) > 0) console.log(`[bulk] swept ${swept} stale job(s)`);
    } catch (e) {
      console.warn("[bulk] sweep_stale_bulk_jobs failed", e);
    }

    // Resolve doc list.
    const q = supa.from("documents").select("id, title, doc_number, status, doc_type, hebrew_content, generated_asset_url, generated_document_url, generated_pdf_url").eq("project_id", projectId).order("doc_number", { ascending: true });
    let docs: { id: string; title: string; doc_number: number | null; status: string; doc_type: string | null; hebrew_content: string | null; generated_asset_url: string | null; generated_document_url: string | null; generated_pdf_url: string | null }[] = [];
    const skipExisting = input.skipExisting !== false;
    if (scope === "ids") {
      const ids = (input.documentIds ?? []).filter(Boolean);
      if (ids.length === 0) return new Response(JSON.stringify({ error: "documentIds required for scope=ids" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data } = await q.in("id", ids);
      docs = (data ?? []) as never;
    } else {
      const { data } = await q;
      docs = (data ?? []) as never;
      if (scope === "from_doc_number") {
        const from = Number(input.fromDocNumber ?? 0);
        const until = input.untilDocNumber ? Number(input.untilDocNumber) : Infinity;
        docs = docs.filter((d) => (d.doc_number ?? 0) >= from && (d.doc_number ?? 0) <= until);
      }
      if (mode !== "draft") {
        docs = docs.filter((d) => d.status !== "final");
      }
    }

    if (skipExisting) {
      docs = docs.filter((d) => {
        if (mode === "draft") return !(d.hebrew_content && d.hebrew_content.trim().length > 0);
        if (mode === "image") return !d.generated_asset_url;
        if (mode === "document") return !(d.generated_document_url || d.generated_pdf_url);
        if (mode === "image_to_pdf") return !!d.generated_asset_url;
        return !(d.generated_asset_url && (d.generated_document_url || d.generated_pdf_url));
      });
    }

    if (docs.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No documents matched the scope.", jobId: null, total: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: job, error: jobErr } = await supa
      .from("bulk_generation_jobs")
      .insert({
        project_id: projectId,
        scope,
        mode,
        document_format: documentFormat,
        document_ids: docs.map((d) => d.id),
        total: docs.length,
        completed: 0,
        failed: 0,
        status: "running",
      } as never)
      .select("id")
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: `Could not create job: ${jobErr?.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const jobId = (job as { id: string }).id;

    // Background worker — wrapped so a crash CANNOT leave the job hanging.
    const work = (async () => {
      const startedAt = Date.now();
      const errors: { id: string; title: string; error: string }[] = [];
      let cancelled = false;
      let timedOut = false;
      let crashed: Error | null = null;

      try {
        if (input.waitForJobId) {
          await waitForPriorJob(supa, input.waitForJobId);
          await beat(supa, jobId);
        }

        let cursor = 0;
        const runOne = async () => {
          while (true) {
            if (Date.now() - startedAt > HARD_TIMEOUT_MS) { timedOut = true; return; }
            if (await isCancelled(supa, jobId)) { cancelled = true; return; }
            const i = cursor++;
            if (i >= docs.length) return;
            const d = docs[i];
            const res = await generateOneDoc(supa, jobId, d, mode, documentFormat, input.imageQuality, input.imageModel);
            await notifyPerDoc(supa, projectId, d, mode, res);
            if (res.ok) {
              await supa.rpc("increment_bulk_completed", { p_job_id: jobId }).then(
                () => {},
                async () => {
                  const { data: row } = await supa.from("bulk_generation_jobs").select("completed").eq("id", jobId).single();
                  await supa.from("bulk_generation_jobs").update({
                    completed: ((row as any)?.completed ?? 0) + 1,
                    last_heartbeat_at: new Date().toISOString(),
                  }).eq("id", jobId);
                },
              );
            } else {
              errors.push({ id: d.id, title: d.title, error: res.error ?? "unknown" });
              await supa.rpc("increment_bulk_failed", { p_job_id: jobId }).then(
                () => {},
                async () => {
                  const { data: row } = await supa.from("bulk_generation_jobs").select("failed").eq("id", jobId).single();
                  await supa.from("bulk_generation_jobs").update({
                    failed: ((row as any)?.failed ?? 0) + 1,
                    last_heartbeat_at: new Date().toISOString(),
                  }).eq("id", jobId);
                },
              );
            }
          }
        };
        await Promise.all(Array.from({ length: concurrency }, () => runOne()));
      } catch (e) {
        crashed = e instanceof Error ? e : new Error(String(e));
        console.error("[bulk] worker crashed", crashed);
      } finally {
        // ALWAYS close the job row.
        try {
          const finalStatus =
            cancelled ? "failed" :
            timedOut ? "failed" :
            crashed ? "failed" :
            errors.length === docs.length ? "failed" : "completed";
          const reason =
            cancelled ? "cancelled by user" :
            timedOut ? `exceeded hard timeout (${Math.round(HARD_TIMEOUT_MS / 60000)} min)` :
            crashed ? `worker crashed: ${crashed.message}` : null;
          const errSummary = errors.length > 0
            ? errors.slice(0, 10).map((e) => `${e.title}: ${e.error}`).join(" | ")
            : null;
          await supa.from("bulk_generation_jobs").update({
            status: finalStatus,
            finished_at: new Date().toISOString(),
            last_heartbeat_at: new Date().toISOString(),
            error: [reason, errSummary].filter(Boolean).join(" || ") || null,
            current_doc_id: null,
            current_doc_title: null,
          }).eq("id", jobId);
        } catch (closeErr) {
          console.error("[bulk] failed to close job row", closeErr);
        }

        if (notifyOnComplete) {
          try {
            const succeeded = docs.length - errors.length - (cancelled || timedOut || crashed ? Math.max(0, docs.length - errors.length - 0) : 0);
            const realSucceeded = docs.length - errors.length;
            const modeLabel =
              mode === "draft" ? "drafting"
              : mode === "image" ? "image generation"
              : mode === "document" ? "file generation"
              : mode === "image_to_pdf" ? "PDF wrapping"
              : "generation";
            const headline =
              cancelled ? `Bulk ${modeLabel} stopped — ${realSucceeded}/${docs.length} done`
              : timedOut ? `Bulk ${modeLabel} hit time limit — ${realSucceeded}/${docs.length} done`
              : crashed ? `Bulk ${modeLabel} crashed — ${realSucceeded}/${docs.length} done`
              : errors.length === 0 ? `Bulk ${modeLabel} complete — ${docs.length} doc${docs.length === 1 ? "" : "s"}`
              : `Bulk ${modeLabel} finished with ${errors.length} failure${errors.length === 1 ? "" : "s"}`;
            const starter = (cancelled || timedOut || crashed)
              ? `The bulk ${modeLabel} run stopped early (${realSucceeded}/${docs.length} done). Please acknowledge briefly and ask me whether to resume the remaining documents (skipping the ones that already finished).`
              : mode === "draft"
              ? `I just finished drafting ${realSucceeded}/${docs.length} documents in bulk. Briefly acknowledge what was drafted and tell me whether you recommend reviewing the drafts or moving straight to generating images + PDFs for all of them.`
              : `I just finished bulk ${modeLabel} on ${realSucceeded}/${docs.length} documents. Briefly acknowledge the result and propose the next step (review, fix any failures, move on to envelopes/hints/marketing — whatever fits the current phase).`;
            await supa.from("project_notifications").insert({
              project_id: projectId,
              kind: "bulk_generation_done",
              title: headline,
              body: `${realSucceeded} / ${docs.length} documents ${mode === "draft" ? "drafted" : "generated"} successfully.${errors.length > 0 ? ` Failed: ${errors.slice(0, 5).map((e) => e.title).join(", ")}` : ""}`,
              starter_prompt: starter,
              created_by: "assistant",
              status: "unread",
            } as never);
          } catch (_e) { /* notifications optional */ }
        }
      }
    })();

    // Use Edge Runtime's keepalive so the platform doesn't kill the worker
    // when this HTTP response returns. Fall back to a logged catch otherwise.
    const ER = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (ER?.waitUntil) {
      ER.waitUntil(work);
    } else {
      work.catch((e) => console.error("[bulk] worker fatal (no EdgeRuntime)", e));
    }

    return new Response(
      JSON.stringify({ ok: true, jobId, total: docs.length, mode, documentFormat }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[bulk-generate-documents] fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

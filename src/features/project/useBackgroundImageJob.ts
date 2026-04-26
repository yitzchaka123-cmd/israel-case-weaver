// Background-safe image generation.
//
// The user can click "Generate" on a portrait/cover/envelope/hint-sheet, then
// close the tab. The edge function runs on Supabase via EdgeRuntime.waitUntil
// and writes the final url into image_generations. This hook:
//   1. Calls generate-image with mode:"background", gets back a jobId.
//   2. Subscribes to that row via realtime so the UI flips when it lands.
//   3. Persists the active job id in localStorage scoped to (project, target,
//      targetId) so reopening the app reattaches to the running job and the
//      countdown timer keeps going.
//   4. Polls every 5s as a safety net in case realtime drops a payload.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type BgImageTarget =
  | "media"
  | "suspect-thumbnail"
  | "suspect-alt-thumbnail"
  | "project-cover"
  | "envelope"
  | "hint-sheet";

export interface StartImageJobInput {
  projectId: string;
  prompt: string;
  target: BgImageTarget;
  targetId?: string;
  modelOverride?: string;
  quality?: "low" | "medium" | "high";
  aspect?: "portrait" | "landscape" | "square";
  category?: string;
  title?: string;
}

export interface BgJobState {
  jobId: string | null;
  status: "idle" | "pending" | "done" | "error";
  url: string | null;
  error: string | null;
  /** Seconds since the job started. Updates every second while pending. */
  elapsedSec: number;
  startedAt: number | null;
}

const initialState: BgJobState = {
  jobId: null,
  status: "idle",
  url: null,
  error: null,
  elapsedSec: 0,
  startedAt: null,
};

function storageKey(projectId: string, target: BgImageTarget, targetId?: string) {
  return `bgimg:${projectId}:${target}:${targetId ?? "_"}`;
}

interface PersistedJob {
  jobId: string;
  startedAt: number;
}

function readPersisted(key: string): PersistedJob | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw) as PersistedJob;
    if (!j?.jobId || !j?.startedAt) return null;
    return j;
  } catch { return null; }
}

function writePersisted(key: string, value: PersistedJob | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch { /* ignore quota errors */ }
}

export function useBackgroundImageJob(opts: {
  projectId: string;
  target: BgImageTarget;
  targetId?: string;
  /** Called when the job finishes successfully with the new image URL. */
  onDone?: (url: string) => void;
  /** Called when the job fails. */
  onError?: (message: string) => void;
}) {
  const { projectId, target, targetId, onDone, onError } = opts;
  const [state, setState] = useState<BgJobState>(initialState);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const detach = useCallback(() => {
    if (channelRef.current) { void supabase.removeChannel(channelRef.current); channelRef.current = null; }
    if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current !== null) { window.clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const finalize = useCallback((next: Pick<BgJobState, "status" | "url" | "error">) => {
    setState((s) => ({ ...s, ...next }));
    detach();
    writePersisted(storageKey(projectId, target, targetId), null);
    if (next.status === "done" && next.url) onDoneRef.current?.(next.url);
    if (next.status === "error" && next.error) onErrorRef.current?.(next.error);
  }, [detach, projectId, target, targetId]);

  const attach = useCallback((jobId: string, startedAt: number) => {
    detach();

    setState({ jobId, status: "pending", url: null, error: null, startedAt, elapsedSec: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) });

    // Tick the visible timer once a second.
    tickRef.current = window.setInterval(() => {
      setState((s) => s.startedAt ? { ...s, elapsedSec: Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000)) } : s);
    }, 1000);

    // Realtime: flip when the row updates.
    const ch = supabase
      .channel(`bgimg-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "image_generations", filter: `id=eq.${jobId}` },
        (payload) => {
          const row = payload.new as { status?: string; url?: string | null; error_message?: string | null };
          if (row.status === "done") finalize({ status: "done", url: row.url ?? null, error: null });
          else if (row.status === "error") finalize({ status: "error", url: null, error: row.error_message ?? "Image generation failed" });
        },
      )
      .subscribe();
    channelRef.current = ch;

    // Safety-net poll every 5s in case realtime drops the payload.
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from("image_generations")
        .select("status, url, error_message")
        .eq("id", jobId)
        .maybeSingle();
      if (!data) return;
      if (data.status === "done") finalize({ status: "done", url: data.url ?? null, error: null });
      else if (data.status === "error") finalize({ status: "error", url: null, error: data.error_message ?? "Image generation failed" });
    }, 5000);
  }, [detach, finalize]);

  // On mount (and whenever target changes), reattach to a persisted job if one
  // is still pending. This is what lets the user close the tab, reopen it, and
  // see the timer continue.
  useEffect(() => {
    const key = storageKey(projectId, target, targetId);
    const persisted = readPersisted(key);
    if (!persisted) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("image_generations")
        .select("status, url, error_message")
        .eq("id", persisted.jobId)
        .maybeSingle();
      if (cancelled) return;
      if (!data) { writePersisted(key, null); return; }
      if (data.status === "done") {
        writePersisted(key, null);
        // Don't fire onDone here — the row's url has already been written into
        // its target table by the worker, and the surface's own query will
        // refetch through realtime. We just clear the in-memory pending state.
        return;
      }
      if (data.status === "error") {
        writePersisted(key, null);
        return;
      }
      attach(persisted.jobId, persisted.startedAt);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, target, targetId]);

  useEffect(() => () => detach(), [detach]);

  const start = useCallback(async (input: Omit<StartImageJobInput, "projectId" | "target" | "targetId">) => {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        projectId,
        target,
        targetId,
        mode: "background",
        ...input,
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.jobId) {
      const msg = json.error ?? `Failed to start (${resp.status})`;
      setState({ ...initialState, status: "error", error: msg });
      onErrorRef.current?.(msg);
      throw new Error(msg);
    }
    const startedAt = Date.now();
    writePersisted(storageKey(projectId, target, targetId), { jobId: json.jobId, startedAt });
    attach(json.jobId, startedAt);
    return json.jobId as string;
  }, [projectId, target, targetId, attach]);

  return { state, start, isPending: state.status === "pending" };
}

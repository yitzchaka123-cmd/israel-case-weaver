// Project-scoped assistant run controller. Lives outside React so the in-flight
// `fetch` survives unmounting the Assistant tab. Backed by a module-level
// Map (per projectId) and surfaced to React via a React Query cache key so the
// pulsing dot, spinners and "is working" banners can subscribe from anywhere
// in the workspace.
//
// Also subscribes to the `assistant_runs` table via realtime — that's the
// cross-tab / cross-device source of truth for "this case is currently being
// worked on". So if the user closes their browser mid-reply, the next visit
// (even from another device) still shows the spinner until the background
// task finishes writing the assistant message.

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

type RunState = {
  isRunning: boolean;
  // Local in-flight fetch (only set when this tab kicked off the run). Lets us
  // cancel mid-flight if the user explicitly aborts. We do NOT abort on tab
  // unmount — the whole point is to keep going.
  controller?: AbortController;
};

const projectRuns = new Map<string, RunState>();

function setRunState(qc: QueryClient, projectId: string, next: RunState) {
  projectRuns.set(projectId, next);
  qc.setQueryData<RunState>(["assistant-run", projectId], next);
}

function readRunState(projectId: string): RunState {
  return projectRuns.get(projectId) ?? { isRunning: false };
}

export function useAssistantRun(projectId: string) {
  const qc = useQueryClient();

  // Local mirror of run state, kept fresh by setQueryData calls and by the
  // realtime subscription below.
  const { data: state = { isRunning: false } } = useQuery<RunState>({
    queryKey: ["assistant-run", projectId],
    queryFn: () => readRunState(projectId),
    staleTime: Infinity,
  });

  // Realtime: any insert/update on assistant_runs for this project flips the
  // shared isRunning flag. This works even after a fresh page load — if a
  // background task is still running on the server, we'll see status='running'
  // and show the spinner.
  useEffect(() => {
    let cancelled = false;
    // Bootstrap: check current DB state for this project.
    void (async () => {
      const { data } = await supabase
        .from("assistant_runs")
        .select("status")
        .eq("project_id", projectId)
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const dbRunning = (data ?? []).length > 0;
      const cur = readRunState(projectId);
      // Only override if local state agrees there's nothing in flight.
      if (!cur.isRunning && dbRunning) setRunState(qc, projectId, { isRunning: true });
    })();

    // Unique channel name per effect run — avoids "cannot add callbacks after
    // subscribe()" when React Strict Mode (or fast refresh) re-runs the effect
    // and the prior channel hasn't been GC'd yet.
    const channel = supabase
      .channel(`assistant-runs-${projectId}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assistant_runs", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { status?: string } | null;
          const status = row?.status;
          if (status === "running") {
            setRunState(qc, projectId, { ...readRunState(projectId), isRunning: true });
          } else if (status === "done" || status === "error") {
            const cur = readRunState(projectId);
            setRunState(qc, projectId, { isRunning: false, controller: cur.controller });
            // Refresh anything the assistant might have touched so other tabs
            // (Suspects, Documents, Case Board) auto-update without a visit.
            qc.invalidateQueries({ queryKey: ["chat", projectId] });
            qc.invalidateQueries({ queryKey: ["project", projectId] });
            qc.invalidateQueries({ queryKey: ["suspects", projectId] });
            qc.invalidateQueries({ queryKey: ["documents", projectId] });
            qc.invalidateQueries({ queryKey: ["nodes", projectId] });
            qc.invalidateQueries({ queryKey: ["envelopes", projectId] });
            qc.invalidateQueries({ queryKey: ["hints", projectId] });
            qc.invalidateQueries({ queryKey: ["production-dashboard", projectId] });
            qc.invalidateQueries({ queryKey: ["phase-bar-counts", projectId] });
            if (status === "done") toast.success("Assistant updated your case");
            else if ((payload.new as { error?: string } | null)?.error) {
              toast.error((payload.new as { error: string }).error);
            }
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [projectId, qc]);

  // Fire-and-forget send. Returns immediately after the server acknowledges
  // the background run; the actual model+tools work continues server-side.
  const sendingRef = useRef(false);
  const send = async (text: string, baseMessages?: Msg[]) => {
    const content = text.trim();
    if (!content) return;
    if (readRunState(projectId).isRunning || sendingRef.current) {
      toast.error("Assistant is still working on the previous turn — give it a moment.");
      return;
    }
    sendingRef.current = true;
    setRunState(qc, projectId, { isRunning: true });

    try {
      const convo = [...(baseMessages ?? []), { role: "user" as const, content }];

      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ projectId, messages: convo, mode: "background" }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        if (resp.status === 429) toast.error("Rate limit — please wait a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits. Top up in Settings → Workspace → Usage.");
        else toast.error(err.error ?? "Assistant error");
        // Server failed before kicking off background work — clear local flag.
        setRunState(qc, projectId, { isRunning: false });
        return;
      }
      // Background mode: server accepted the run and will write the assistant
      // message asynchronously. The realtime subscription on assistant_runs
      // will flip isRunning back to false when it finishes. We immediately
      // refresh the chat query so the user's message appears right away.
      qc.invalidateQueries({ queryKey: ["chat", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assistant error");
      setRunState(qc, projectId, { isRunning: false });
    } finally {
      sendingRef.current = false;
    }
  };

  // Cancel the in-flight run (best-effort): aborts the local fetch if this tab
  // started it, and clears the local isRunning flag so the user can immediately
  // kick off a new turn (e.g. via Edit & re-run). The realtime subscription on
  // assistant_runs is still the source of truth across tabs/devices — if the
  // server-side background task is already mid-flight, it will still finish
  // and write its result, but editAndResend's delete-tail logic cleans it up.
  const cancel = () => {
    const cur = readRunState(projectId);
    cur.controller?.abort();
    sendingRef.current = false;
    setRunState(qc, projectId, { isRunning: false });
  };

  return {
    isRunning: state.isRunning,
    send,
    cancel,
  };
}

// Lightweight read-only subscription for components that only need to know
// "is the assistant working?" (Overview banner, ProductionDashboard banner,
// Assistant tab pulsing dot). Avoids wiring up the full send() API.
export function useAssistantRunStatus(projectId: string) {
  const { isRunning } = useAssistantRun(projectId);
  return isRunning;
}

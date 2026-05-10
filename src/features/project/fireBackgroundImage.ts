// Fire-and-forget wrapper for background image generation.
//
// For surfaces that already have their own realtime subscription (media_assets,
// project_marketing, project_storyboards), we don't need a per-job hook — we
// just need to kick the edge function and let realtime repaint when the image
// lands. The browser can close mid-flight; the worker keeps running on
// Supabase via EdgeRuntime.waitUntil.
import { supabase } from "@/integrations/supabase/client";

export type BgFireTarget =
  | "media"
  | "project-cover"
  | "envelope"
  | "hint-sheet"
  | "storyboard-shot"
  | "suspect-thumbnail"
  | "suspect-alt-thumbnail";

export interface FireBackgroundImageInput {
  projectId: string;
  prompt: string;
  target?: BgFireTarget;
  targetId?: string;
  modelOverride?: string;
  quality?: "low" | "medium" | "high";
  aspect?: "portrait" | "landscape" | "square";
  category?: string;
  title?: string;
  /** Optional brand/style reference image (URL). When provided, the model
   *  receives it as a real vision input — not just mentioned in text — so the
   *  output inherits the same publisher's visual identity. */
  referenceImageUrl?: string | null;
  referenceLabel?: string | null;
}

export interface FireBackgroundImageResult {
  ok: boolean;
  jobId?: string;        // real media_assets row id (only when ok=true)
  pseudoId?: string;     // synthesized id when the kick failed before INSERT
  kickFailed?: boolean;  // true when the queue function 5xx'd / network died
  status?: number;
  error?: string;
}

let pseudoCounter = 0;
function makePseudoId(): string {
  pseudoCounter += 1;
  return `kick-failed-${Date.now()}-${pseudoCounter}`;
}

export async function fireBackgroundImage(input: FireBackgroundImageInput): Promise<FireBackgroundImageResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ ...input, mode: "background" }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.jobId) {
      return {
        ok: false, kickFailed: true, pseudoId: makePseudoId(),
        status: resp.status, error: json.error ?? `Failed (${resp.status})`,
      };
    }
    return { ok: true, jobId: json.jobId as string, status: resp.status };
  } catch (e) {
    return {
      ok: false, kickFailed: true, pseudoId: makePseudoId(),
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

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
}

export interface FireBackgroundImageResult {
  ok: boolean;
  jobId?: string;
  status?: number;
  error?: string;
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
      return { ok: false, status: resp.status, error: json.error ?? `Failed (${resp.status})` };
    }
    return { ok: true, jobId: json.jobId as string, status: resp.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

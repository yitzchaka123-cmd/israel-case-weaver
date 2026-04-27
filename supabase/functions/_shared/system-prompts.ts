// Shared resolver for editable system prompts (Master + per-surface overrides).
//
// Every edge function that builds a system prompt should call resolveSystemPrompt.
// It reads the user's active Master Prompt + the active per-surface override from
// the `system_prompts` table and composes them with the function's hardcoded
// DEFAULT_SYSTEM body — which always remains the source-of-truth fallback.
//
// Returns:
//   - `system`:        the final system message to send to the model (may be empty
//                      string if injection_mode === 'user_header' AND surface body is "")
//   - `userHeader`:    text to PREPEND to the user message (empty unless master uses
//                      'user_header' mode)
//   - `surfaceVersion`/`masterVersion`: for ai_run_logs

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type InjectionMode = "system_prefix" | "system_suffix" | "user_header" | "replace";

interface PromptRow {
  body: string;
  injection_mode: InjectionMode;
  version: number;
}

export interface ResolvedSystemPrompt {
  system: string;
  userHeader: string;
  surfaceVersion: number | null;
  masterVersion: number | null;
}

const SEPARATOR = "\n\n---\n\n";

export function getServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE);
}

export async function resolveSystemPrompt(opts: {
  supa?: SupabaseClient;
  ownerId: string | null | undefined;
  surface: string;        // e.g. "suggest-image-prompt:inline-image"
  defaultBody: string;    // hardcoded fallback shipped in code
}): Promise<ResolvedSystemPrompt> {
  const supa = opts.supa ?? getServiceClient();

  if (!opts.ownerId) {
    return { system: opts.defaultBody, userHeader: "", surfaceVersion: null, masterVersion: null };
  }

  // Fetch master + surface override in one round-trip.
  const { data, error } = await supa
    .from("system_prompts")
    .select("surface, body, injection_mode, version")
    .eq("owner_id", opts.ownerId)
    .in("surface", ["master", opts.surface])
    .eq("is_active", true);

  if (error || !data) {
    return { system: opts.defaultBody, userHeader: "", surfaceVersion: null, masterVersion: null };
  }

  const master = data.find((r: { surface: string }) => r.surface === "master") as (PromptRow & { surface: string }) | undefined;
  const override = data.find((r: { surface: string }) => r.surface === opts.surface) as (PromptRow & { surface: string }) | undefined;

  const surfaceBody = override?.body?.trim() ? override.body : opts.defaultBody;
  const masterBody = master?.body?.trim() ?? "";
  const masterMode: InjectionMode = master?.injection_mode ?? "system_prefix";

  let system = surfaceBody;
  let userHeader = "";

  if (masterBody) {
    if (masterMode === "system_prefix") {
      system = `${masterBody}${SEPARATOR}${surfaceBody}`;
    } else if (masterMode === "system_suffix") {
      system = `${surfaceBody}${SEPARATOR}${masterBody}`;
    } else if (masterMode === "user_header") {
      userHeader = masterBody;
    } else if (masterMode === "replace") {
      // dangerous, but supported — Master fully replaces the surface body.
      system = masterBody;
    }
  }

  return {
    system,
    userHeader,
    surfaceVersion: override?.version ?? null,
    masterVersion: master?.version ?? null,
  };
}

/**
 * Convenience: prepend userHeader to a user message string when present.
 */
export function applyUserHeader(userMsg: string, header: string): string {
  if (!header.trim()) return userMsg;
  return `${header}${SEPARATOR}${userMsg}`;
}

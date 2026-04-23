// Pure helpers that decide whether a setup change deserves an assistant
// "callback" notification. Returns a draft payload (or null) that the caller
// inserts into project_notifications. Trigger only fires when the field
// actually changed AND the relevant phase has already passed — so first-time
// setup doesn't drown the user in alerts.
import type { NotificationDraft } from "./useProjectNotifications";

export type TriggerableField =
  | "selling_point_toggle_on"
  | "difficulty"
  | "mystery_type"
  | "genre"
  | "player_role"
  | "target_doc_count"
  | "case_goal";

const PHASES_AFTER_SETUP = new Set(["summary", "structure", "logic", "documents", "envelopes", "hints", "packaging", "done"]);
const PHASES_AFTER_SUMMARY = new Set(["structure", "logic", "documents", "envelopes", "hints", "packaging", "done"]);

function pastSetup(phase: string | null | undefined): boolean {
  return !!phase && PHASES_AFTER_SETUP.has(phase);
}
function pastSummary(phase: string | null | undefined): boolean {
  return !!phase && PHASES_AFTER_SUMMARY.has(phase);
}

interface ProjectLike {
  phase?: string | null;
  difficulty?: string | null;
  target_doc_count?: number | null;
}

export function notifyForFieldChange(
  field: TriggerableField,
  oldValue: unknown,
  newValue: unknown,
  project: ProjectLike,
): NotificationDraft | null {
  if (field === "selling_point_toggle_on") {
    // Always notifies when the user explicitly toggles the extra selling
    // point ON (no phase gate — it's a planning ask, not a re-balance).
    return {
      kind: "selling_point",
      title: "Come plan the extra selling point with me.",
      body: "You turned on the optional extra selling point — let's design what makes this case stand out.",
      starter_prompt: "Let's plan the extra selling point for this case.",
      created_by: "user",
    };
  }

  // For all other rules: must have actually changed and we must be past setup.
  const same = String(oldValue ?? "").trim() === String(newValue ?? "").trim();
  if (same) return null;

  if (field === "difficulty" && pastSetup(project.phase)) {
    const x = String(newValue ?? "").trim() || "—";
    return {
      kind: "difficulty",
      title: `You changed difficulty to ${x} — let's re-balance.`,
      body: "Difficulty drives suspect count, hint pacing, and red-herring density. Let's adjust the plan together.",
      starter_prompt: `Difficulty just changed to ${x}. Walk me through what to adjust.`,
      created_by: "user",
    };
  }

  if ((field === "mystery_type" || field === "genre") && pastSetup(project.phase)) {
    const v = String(newValue ?? "").trim() || "—";
    const niceField = field === "mystery_type" ? "mystery type" : "genre";
    return {
      kind: field,
      title: `${niceField === "mystery type" ? "Mystery type" : "Genre"} changed — want me to refresh the case brief?`,
      body: `Changing ${niceField} ripples through the brief, suspects, and document tone.`,
      starter_prompt: `I changed ${niceField} to ${v}. Refresh the case brief to match.`,
      created_by: "user",
    };
  }

  if (field === "player_role" && pastSetup(project.phase)) {
    const v = String(newValue ?? "").trim() || "—";
    return {
      kind: "player_role",
      title: "Player role changed — should I rework the brief?",
      body: "The player's role shapes voice, access level, and document framing.",
      starter_prompt: `Player role is now: ${v}. What should we adjust?`,
      created_by: "user",
    };
  }

  if (field === "target_doc_count" && pastSetup(project.phase)) {
    const n = newValue == null ? "—" : String(newValue);
    return {
      kind: "target_doc_count",
      title: "Doc count changed — production plan needs a re-look.",
      body: "Document count drives envelope flow and pacing. Let's re-plan.",
      starter_prompt: `Re-plan documents around ${n} total.`,
      created_by: "user",
    };
  }

  if (field === "case_goal" && pastSummary(project.phase)) {
    return {
      kind: "case_goal",
      title: "Case goal edited — should I update the summary?",
      body: "The summary references the case goal directly. They may have drifted out of sync.",
      starter_prompt: "I tweaked the case goal — sync the summary.",
      created_by: "user",
    };
  }

  return null;
}

/**
 * Fires once when every envelope has both `task` and `design_instructions`
 * filled in. Nudges the user toward the next step (logic flow generation,
 * which now wires envelopes into the board as nodes).
 *
 * Caller is responsible for de-duping (e.g. only call when the
 * "all-drafted" boolean transitions from false → true).
 */
export function notifyEnvelopesDrafted(): NotificationDraft {
  return {
    kind: "envelopes_drafted",
    title: "Envelopes are drafted — wire them into the board.",
    body: "All envelopes have a task and a design brief. Generate the logic flow next so they become nodes connected to the case.",
    starter_prompt:
      "All envelopes are drafted. Walk me through generating the logic flow so the envelopes become nodes wired into the case.",
    created_by: "user",
  };
}

import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

type SnapshotReason = "manual" | "auto" | "before_delete" | "before_restore";

const RELATED_TABLES = [
  "suspects",
  "documents",
  "canvas_nodes",
  "canvas_edges",
  "envelopes",
  "hints",
  "hint_sheets",
  "media_assets",
  "prompts",
  "chat_messages",
  "project_marketing",
  "project_storyboards",
  "project_notifications",
] as const;

export type ProjectVersionSummary = {
  title?: string;
  subtitle?: string | null;
  phase?: string;
  cover_image_url?: string | null;
  counts: Record<string, number>;
  suspects: string[];
  documents: string[];
  nodes: string[];
  marketing?: string | null;
};

export type ProjectVersion = {
  id: string;
  project_id: string;
  label: string | null;
  reason: SnapshotReason;
  created_at: string;
  summary: ProjectVersionSummary;
  snapshot?: Record<string, any>;
};

async function buildSnapshot(projectId: string) {
  const [{ data: project, error: projectError }, ...related] = await Promise.all([
    db.from("projects").select("*").eq("id", projectId).single(),
    ...RELATED_TABLES.map((table) => db.from(table).select("*").eq("project_id", projectId)),
  ]);
  if (projectError) throw projectError;
  if (!project) throw new Error("Project not found");

  const snapshot: Record<string, any> = { project };
  RELATED_TABLES.forEach((table, index) => {
    const result = related[index] as { data: any[] | null; error: Error | null };
    if (result.error) throw result.error;
    snapshot[table] = result.data ?? [];
  });

  const summary: ProjectVersionSummary = {
    title: project.title,
    subtitle: project.subtitle,
    phase: project.phase,
    cover_image_url: project.cover_image_url,
    counts: Object.fromEntries(RELATED_TABLES.map((table) => [table, snapshot[table]?.length ?? 0])),
    suspects: (snapshot.suspects ?? []).slice(0, 8).map((s: any) => s.name).filter(Boolean),
    documents: (snapshot.documents ?? []).slice(0, 10).map((d: any) => d.title).filter(Boolean),
    nodes: (snapshot.canvas_nodes ?? []).slice(0, 10).map((n: any) => n.title).filter(Boolean),
    marketing: snapshot.project_marketing?.[0]?.back_headline ?? snapshot.project_marketing?.[0]?.tagline ?? null,
  };

  return { project, snapshot, summary };
}

export async function createProjectVersion(projectId: string, label: string | null, reason: SnapshotReason = "manual") {
  const { data: userResult } = await supabase.auth.getUser();
  const { project, snapshot, summary } = await buildSnapshot(projectId);
  const { data, error } = await db
    .from("project_versions")
    .insert({
      project_id: projectId,
      owner_id: project.owner_id,
      created_by: userResult.user?.id ?? null,
      label: label?.trim() || null,
      reason,
      snapshot,
      summary,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function listProjectVersions(projectId: string) {
  const { data, error } = await db
    .from("project_versions")
    .select("id,project_id,label,reason,created_at,summary")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectVersion[];
}

export async function getProjectVersion(versionId: string) {
  const { data, error } = await db
    .from("project_versions")
    .select("id,project_id,label,reason,created_at,summary,snapshot")
    .eq("id", versionId)
    .single();
  if (error) throw error;
  return data as ProjectVersion;
}

export async function trashProject(projectId: string) {
  await createProjectVersion(projectId, "Before moving to trash", "before_delete");
  const { error } = await db.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", projectId);
  if (error) throw error;
}

export async function restoreTrashedProject(projectId: string) {
  const { error } = await db.from("projects").update({ deleted_at: null }).eq("id", projectId);
  if (error) throw error;
}

export async function permanentlyDeleteProject(projectId: string) {
  await Promise.all(RELATED_TABLES.map((table) => db.from(table).delete().eq("project_id", projectId)));
  await db.from("project_versions").delete().eq("project_id", projectId);
  const { error } = await db.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

export async function restoreProjectVersion(versionId: string) {
  const version = await getProjectVersion(versionId);
  await createProjectVersion(version.project_id, "Before restoring older version", "before_restore");
  const snapshot = version.snapshot ?? {};
  const project = { ...(snapshot.project ?? {}), id: version.project_id, deleted_at: null };

  const { error: projectError } = await db.from("projects").update(project).eq("id", version.project_id);
  if (projectError) throw projectError;

  for (const table of RELATED_TABLES) {
    const { error: deleteError } = await db.from(table).delete().eq("project_id", version.project_id);
    if (deleteError) throw deleteError;
    const rows = ((snapshot[table] ?? []) as any[]).map((row) => ({ ...row, project_id: version.project_id }));
    if (rows.length) {
      const { error: insertError } = await db.from(table).insert(rows);
      if (insertError) throw insertError;
    }
  }
}
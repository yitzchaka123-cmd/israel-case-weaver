import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ProjectWorkspace } from "@/features/project/ProjectWorkspace";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectRoute,
});

function ProjectRoute() {
  const { session, loading, accessStatus } = useAuth();
  const { projectId } = Route.useParams();
  if (loading) return null;
  if (!session) return <Navigate to="/login" />;
  if (accessStatus !== "approved" && accessStatus !== "unknown") return <Navigate to="/pending" />;
  if (accessStatus === "unknown") return null;
  return <AppShell><ProjectWorkspace projectId={projectId} /></AppShell>;
}

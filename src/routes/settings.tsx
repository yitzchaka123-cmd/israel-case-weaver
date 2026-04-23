import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { SettingsPage } from "@/features/settings/SettingsPage";

export const Route = createFileRoute("/settings")({
  component: Route1,
});

function Route1() {
  const { session, loading, accessStatus } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" />;
  if (accessStatus !== "approved" && accessStatus !== "unknown") return <Navigate to="/pending" />;
  if (accessStatus === "unknown") return null;
  return <AppShell><SettingsPage /></AppShell>;
}

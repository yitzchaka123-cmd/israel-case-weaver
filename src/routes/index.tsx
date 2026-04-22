import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/")({
  component: IndexRoute,
});

function IndexRoute() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/login" />;
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}

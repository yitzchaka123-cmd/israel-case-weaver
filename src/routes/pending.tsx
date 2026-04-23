import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Clock, RefreshCw, LogOut, ShieldAlert } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});

function PendingPage() {
  const { session, loading, accessStatus, refreshAccess, signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  if (loading) return null;
  if (!session) return <Navigate to="/login" />;
  if (accessStatus === "approved") return <Navigate to="/" />;

  const blocked = accessStatus === "blocked";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-card border rounded-2xl p-8 shadow-soft text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-accent/10 flex items-center justify-center mb-5">
          {blocked ? (
            <ShieldAlert className="h-6 w-6 text-destructive" />
          ) : (
            <Clock className="h-6 w-6 text-accent" />
          )}
        </div>
        <h1 className="font-display text-2xl">
          {blocked ? "Access blocked" : "Awaiting approval"}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {blocked
            ? "An admin has blocked this account. Reach out if you think this is a mistake."
            : "Thanks for signing in. An admin needs to approve your account before you can use the studio. You'll get in here automatically the moment they do."}
        </p>
        <div className="mt-6 text-xs text-muted-foreground">
          Signed in as <span className="text-foreground">{session.user.email}</span>
        </div>
        <div className="mt-6 flex gap-2 justify-center">
          {!blocked && (
            <Button
              variant="outline"
              onClick={async () => {
                setRefreshing(true);
                await refreshAccess();
                setRefreshing(false);
              }}
              disabled={refreshing}
            >
              <RefreshCw className={"h-4 w-4 mr-2 " + (refreshing ? "animate-spin" : "")} />
              Check status
            </Button>
          )}
          <Button variant="ghost" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

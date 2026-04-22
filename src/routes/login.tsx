import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { session, signInWithGoogle, loading } = useAuth();
  if (!loading && session) return <Navigate to="/" />;

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      <div className="hidden md:flex relative overflow-hidden bg-gradient-soft items-center justify-center p-12">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, var(--color-accent), transparent 50%), radial-gradient(circle at 80% 70%, oklch(0.7 0.2 20), transparent 50%)" }} />
        <div className="relative max-w-md">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-surface text-xs font-medium text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Internal production suite
          </div>
          <h1 className="font-display text-5xl text-balance leading-[1.05]">
            Craft premium mystery games from concept to print.
          </h1>
          <p className="mt-5 text-muted-foreground text-balance">
            A unified workspace where AI assistance, a visual case board, and every
            document, suspect, and asset stay in perfect sync.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3 text-xs">
            {["Case board", "Document library", "Media & prompts"].map((f) => (
              <div key={f} className="rounded-lg border bg-surface/60 px-3 py-2.5 text-center">
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5 mb-10">
            <div className="h-10 w-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-display text-xl leading-none">Mystery Studio</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
                Production Suite
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to continue your investigations.
          </p>
          <Button
            onClick={signInWithGoogle}
            className="mt-8 w-full h-11 gap-3"
            variant="outline"
          >
            <GoogleIcon />
            Continue with Google
          </Button>
          <p className="mt-6 text-xs text-muted-foreground text-center">
            For invited team members only. All data is shared across the workspace.
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

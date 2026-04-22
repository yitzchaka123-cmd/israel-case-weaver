import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ReactNode } from "react";
import { LayoutDashboard, Settings, Moon, Sun, LogOut, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav1 = useNavigate();
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-6 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="font-display text-lg leading-none">Mystery Studio</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              Production Suite
            </div>
          </div>
        </div>
        <nav className="px-3 py-2 space-y-1 flex-1">
          {nav.map((n) => {
            const active = loc.pathname === n.to || (n.to !== "/" && loc.pathname.startsWith(n.to));
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={[
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.user_metadata?.avatar_url} />
              <AvatarFallback>{user?.email?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {user?.user_metadata?.full_name || user?.email?.split("@")[0]}
              </div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="flex-1" onClick={toggle}>
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={async () => {
                await signOut();
                nav1({ to: "/login" });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

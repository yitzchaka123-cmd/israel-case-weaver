import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ReactNode, useState } from "react";
import { ChevronDown, Gamepad2, LayoutDashboard, LogOut, Moon, Palette, Settings, Sparkles, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const settingsSections = [
  { id: "branding", label: "Branding" },
  { id: "appearance", label: "Appearance" },
  { id: "profile", label: "Profile" },
  { id: "image-prompt-assistant", label: "Image prompt assistant" },
  { id: "assistant-playbook", label: "Assistant playbook" },
  { id: "assistant-tweaks", label: "Assistant tweaks" },
  { id: "ai-routing", label: "AI routing" },
  { id: "ai-connections", label: "AI connections" },
  { id: "usage-credits", label: "Usage & credits" },
  { id: "ai-activity-log", label: "AI activity log" },
  { id: "api-keys", label: "API keys" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav1 = useNavigate();
  const { user, signOut, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const dashboardActive = loc.pathname === "/" || loc.pathname.startsWith("/projects/");
  const settingsActive = loc.pathname === "/settings";
  const [dashboardOpen, setDashboardOpen] = useState(dashboardActive);
  const [settingsOpen, setSettingsOpen] = useState(settingsActive);

  const { data: projects } = useQuery({
    queryKey: ["sidebar-projects", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("projects")
        .select("id,title")
        .order("updated_at", { ascending: false })
        .limit(8);
      return (data ?? []) as Array<{ id: string; title: string }>;
    },
    enabled: !!user,
  });

  const { data: appLogoUrl } = useQuery({
    queryKey: ["app-logo", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("app_logo_url").eq("id", user.id).maybeSingle();
      return (data as { app_logo_url?: string | null } | null)?.app_logo_url ?? null;
    },
    enabled: !!user,
  });

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-60 flex-col border-r border-white/40 dark:border-border bg-sidebar/70 dark:bg-sidebar text-sidebar-foreground backdrop-blur-2xl">
        <div className="px-5 py-6 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow overflow-hidden">
            {appLogoUrl ? (
              <img src={appLogoUrl} alt="Logo" className="h-full w-full object-cover" />
            ) : (
              <Sparkles className="h-4 w-4 text-white" />
            )}
          </div>
          <div>
            <div className="font-display text-lg leading-none">Mystery Studio</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              Production Suite
            </div>
          </div>
        </div>
        <nav className="px-3 py-2 space-y-3 flex-1 overflow-y-auto">
          <SidebarGroup
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="Dashboard"
            to="/"
            active={dashboardActive}
            open={dashboardOpen || dashboardActive}
            onToggle={() => setDashboardOpen((v) => !v)}
          >
            <SidebarSubLink to="/" label="Case Archive" active={loc.pathname === "/"} />
            {(projects ?? []).length > 0 && (
              <div className="pt-1">
                <div className="px-3 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Games</div>
                {(projects ?? []).map((project) => (
                  <Link
                    key={project.id}
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className={[
                      "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors min-w-0",
                      loc.pathname === `/projects/${project.id}`
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    ].join(" ")}
                  >
                    <Gamepad2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{project.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </SidebarGroup>

          <SidebarGroup
            icon={<Settings className="h-4 w-4" />}
            label="Settings"
            to="/settings"
            active={settingsActive}
            open={settingsOpen || settingsActive}
            onToggle={() => setSettingsOpen((v) => !v)}
          >
            {[...settingsSections, ...(isAdmin ? [{ id: "team-access", label: "Team access" }] : [])].map((section) => (
              <SidebarSubLink
                key={section.id}
                to="/settings"
                hash={section.id}
                label={section.label}
                active={settingsActive && loc.hash === section.id}
                icon={<Palette className="h-3.5 w-3.5" />}
              />
            ))}
          </SidebarGroup>
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

function SidebarGroup({
  icon,
  label,
  to,
  active,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  label: string;
  to: "/" | "/settings";
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className={[
          "flex items-center rounded-lg transition-colors",
          active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        ].join(" ")}
      >
        <Link to={to} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-sm font-medium">
          {icon}
          <span className="truncate">{label}</span>
        </Link>
        <button type="button" onClick={onToggle} className="p-2" aria-label={`Toggle ${label} menu`}>
          <ChevronDown className={["h-4 w-4 transition-transform", open ? "rotate-180" : ""].join(" ")} />
        </button>
      </div>
      {open && <div className="ml-4 border-l border-sidebar-border/70 pl-2 space-y-0.5">{children}</div>}
    </div>
  );
}

function SidebarSubLink({
  to,
  hash,
  label,
  active,
  icon,
}: {
  to: "/" | "/settings";
  hash?: string;
  label: string;
  active: boolean;
  icon?: ReactNode;
}) {
  return (
    <Link
      to={to}
      hash={hash}
      className={[
        "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors min-w-0",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      ].join(" ")}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

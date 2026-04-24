import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trash2, LayoutDashboard, Sparkles, Network, Users, FileText, Mail, Lightbulb, Image as ImageIcon, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { ProjectOverview } from "./ProjectOverview";
import { SuspectsSection } from "./SuspectsSection";
import { DocumentsSection } from "./DocumentsSection";
import { CanvasSection } from "./CanvasSection";
import { AssistantSection } from "./AssistantSection";
import { EnvelopesSection } from "./EnvelopesSection";
import { HintsSection } from "./HintsSection";
import { MediaSection } from "./MediaSection";
import { MediaLibrarySection } from "./MediaLibrarySection";
import { MarketingSection } from "./MarketingSection";
import { ExportMenu } from "./ExportMenu";
import { PhaseStatusBar } from "./PhaseStatusBar";
import { NotificationBell } from "./notifications/NotificationBell";
import { useAssistantRunStatus } from "./assistant/useAssistantRun";
import { ProjectHistoryPanel } from "./ProjectHistoryPanel";
import { trashProject } from "@/lib/project-versions";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const assistantRunning = useAssistantRunStatus(projectId);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [tab]);

  // Allow other components (e.g. assistant tool-call receipts and origin badges)
  // to switch tabs and optionally focus a specific item or chat message by
  // dispatching a `mystudio:navigate` event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: string; messageId?: string }>).detail;
      if (!detail?.tab) return;
      setTab(detail.tab);
      if (detail.messageId) {
        // Re-set even if same id so AssistantSection re-triggers scroll/highlight.
        setFocusMessageId(null);
        setTimeout(() => setFocusMessageId(detail.messageId!), 0);
      }
    };
    window.addEventListener("mystudio:navigate", handler as EventListener);
    return () => window.removeEventListener("mystudio:navigate", handler as EventListener);
  }, []);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Realtime subscription keeps project state in sync across users/tabs
  useEffect(() => {
    const channel = supabase
      .channel(`project-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["project", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "suspects", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["suspects", projectId] });
        qc.invalidateQueries({ queryKey: ["production-dashboard", projectId] });
        qc.invalidateQueries({ queryKey: ["phase-bar-counts", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["documents", projectId] });
        qc.invalidateQueries({ queryKey: ["production-dashboard", projectId] });
        qc.invalidateQueries({ queryKey: ["phase-bar-counts", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "canvas_nodes", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["nodes", projectId] });
        qc.invalidateQueries({ queryKey: ["production-dashboard", projectId] });
        qc.invalidateQueries({ queryKey: ["phase-bar-counts", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "canvas_edges", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["edges", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "envelopes", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["envelopes", projectId] });
        qc.invalidateQueries({ queryKey: ["production-dashboard", projectId] });
        qc.invalidateQueries({ queryKey: ["phase-bar-counts", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "hints", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["hints", projectId] });
        qc.invalidateQueries({ queryKey: ["production-dashboard", projectId] });
        qc.invalidateQueries({ queryKey: ["phase-bar-counts", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "project_notifications", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["project-notifications", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "project_marketing", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["project-marketing", projectId] });
        qc.invalidateQueries({ queryKey: ["project-marketing-barcode", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "project_storyboards", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["project-storyboards", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "media_assets", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["marketing-assets", projectId] });
        qc.invalidateQueries({ queryKey: ["marketing-back-assets", projectId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, qc]);

  const deleteProject = async () => {
    if (!confirm("Move this case to trash? A restorable version will be saved first.")) return;
    try {
      await trashProject(projectId);
      toast.success("Case moved to trash");
      nav({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move case to trash");
    }
  };

  if (isLoading || !project) {
    return <div className="p-10 text-muted-foreground">Loading case file…</div>;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="border-b bg-surface/80 backdrop-blur sticky top-0 z-10">
        <div className="px-6 md:px-10 py-4 flex items-center gap-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {project.cover_image_url && (
            <div className="h-10 w-10 rounded-full overflow-hidden border border-border shrink-0 bg-muted">
              <img
                src={project.cover_image_url}
                alt={project.title}
                className="h-full w-full object-cover"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
              Case File
            </div>
            <h1 className="font-display text-2xl leading-tight truncate">{project.title}</h1>
          </div>
          <div className="hidden md:block">
            <PhaseStatusBar
              projectId={projectId}
              phase={project.phase}
              targetDocCount={project.target_doc_count ?? null}
              onJump={setTab}
            />
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell
              projectId={projectId}
              onOpenAssistant={(prompt) => {
                setTab("assistant");
                // Defer until tab actually mounts/focuses, then dispatch the prompt.
                window.setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("mystudio:assistant-prompt", { detail: { projectId, prompt } }),
                  );
                }, 50);
              }}
            />
            <ProjectHistoryPanel projectId={projectId} />
            <ExportMenu projectId={projectId} />
            <Button size="icon" variant="ghost" onClick={deleteProject} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <div className="relative px-4 md:px-10">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-surface/90 to-transparent md:hidden" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-surface/90 to-transparent md:hidden" />
            <div className="scrollbar-none overflow-x-auto overscroll-x-contain touch-pan-x">
            <TabsList className="bg-transparent p-0 h-auto gap-1 border-0 min-w-max">
              {[
                { v: "overview", l: "Overview", icon: LayoutDashboard },
                { v: "assistant", l: "Assistant", icon: Sparkles },
                { v: "canvas", l: "Case Board", icon: Network },
                { v: "suspects", l: "Suspects", icon: Users },
                { v: "documents", l: "Documents", icon: FileText },
                { v: "envelopes", l: "Envelopes", icon: Mail },
                { v: "hints", l: "Hints", icon: Lightbulb },
                { v: "marketing", l: "Marketing", icon: Megaphone },
                { v: "generation", l: "Generation", icon: Sparkles },
                { v: "media", l: "Media", icon: ImageIcon },
              ].map((t) => {
                const Icon = t.icon;
                const showPulse = t.v === "assistant" && assistantRunning;
                return (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    ref={(node) => { tabRefs.current[t.v] = node; }}
                    className="data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none text-muted-foreground relative px-3 py-2.5 rounded-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent data-[state=active]:after:rounded-full inline-flex items-center gap-1.5 shrink-0"
                  >
                    <span className="relative inline-flex">
                      <Icon className="h-3.5 w-3.5" />
                      {showPulse && (
                        <span className="absolute -top-0.5 -right-1 flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                        </span>
                      )}
                    </span>
                    {t.l}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            </div>
          </div>
        </Tabs>
      </header>

      <div className="flex-1 overflow-hidden">
        <Tabs value={tab} onValueChange={setTab} className="h-full">
          <TabsContent value="overview" className="h-full overflow-auto m-0">
            <ProjectOverview project={project} />
          </TabsContent>
          <TabsContent value="assistant" className="h-full m-0">
            <AssistantSection projectId={projectId} phase={project.phase} focusMessageId={focusMessageId} />
          </TabsContent>
          <TabsContent value="canvas" className="h-full m-0">
            <CanvasSection projectId={projectId} />
          </TabsContent>
          <TabsContent value="suspects" className="h-full overflow-auto m-0">
            <SuspectsSection projectId={projectId} />
          </TabsContent>
          <TabsContent value="documents" className="h-full overflow-auto m-0">
            <DocumentsSection projectId={projectId} />
          </TabsContent>
          <TabsContent value="envelopes" className="h-full overflow-auto m-0">
            <EnvelopesSection projectId={projectId} />
          </TabsContent>
          <TabsContent value="hints" className="h-full overflow-auto m-0">
            <HintsSection projectId={projectId} />
          </TabsContent>
          <TabsContent value="marketing" className="h-full overflow-auto m-0">
            <MarketingSection projectId={projectId} />
          </TabsContent>
          <TabsContent value="generation" className="h-full overflow-auto m-0">
            <MediaSection projectId={projectId} />
          </TabsContent>
          <TabsContent value="media" className="h-full overflow-auto m-0">
            <MediaLibrarySection projectId={projectId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

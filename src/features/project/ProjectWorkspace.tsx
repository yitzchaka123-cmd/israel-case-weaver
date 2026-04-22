import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProjectOverview } from "./ProjectOverview";
import { SuspectsSection } from "./SuspectsSection";
import { DocumentsSection } from "./DocumentsSection";
import { CanvasSection } from "./CanvasSection";
import { AssistantSection } from "./AssistantSection";
import { EnvelopesSection } from "./EnvelopesSection";
import { HintsSection } from "./HintsSection";
import { MediaSection } from "./MediaSection";
import { ExportMenu } from "./ExportMenu";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");

  // Allow other components (e.g. assistant tool-call receipts) to switch tabs
  // and optionally focus a specific item by dispatching a `mystudio:navigate` event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: string }>).detail;
      if (detail?.tab) setTab(detail.tab);
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
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["documents", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "canvas_nodes", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["nodes", projectId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "canvas_edges", filter: `project_id=eq.${projectId}` }, () => {
        qc.invalidateQueries({ queryKey: ["edges", projectId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, qc]);

  const deleteProject = async () => {
    if (!confirm("Delete this case permanently? This cannot be undone.")) return;
    const { error } = await supabase.from("projects").delete().eq("id", projectId);
    if (error) return toast.error(error.message);
    toast.success("Case deleted");
    nav({ to: "/" });
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
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
              Case File
            </div>
            <h1 className="font-display text-2xl leading-tight truncate">{project.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:inline text-xs text-muted-foreground capitalize px-2.5 py-1 rounded-md bg-muted">
              Phase · {project.phase}
            </span>
            <ExportMenu projectId={projectId} />
            <Button size="icon" variant="ghost" onClick={deleteProject} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <div className="px-6 md:px-10">
            <TabsList className="bg-transparent p-0 h-auto gap-1 border-0">
              {[
                { v: "overview", l: "Overview" },
                { v: "assistant", l: "Assistant" },
                { v: "canvas", l: "Case Board" },
                { v: "suspects", l: "Suspects" },
                { v: "documents", l: "Documents" },
                { v: "envelopes", l: "Envelopes" },
                { v: "hints", l: "Hints" },
                { v: "media", l: "Media" },
              ].map((t) => (
                <TabsTrigger
                  key={t.v}
                  value={t.v}
                  className="data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none text-muted-foreground relative px-3 py-2.5 rounded-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent data-[state=active]:after:rounded-full"
                >
                  {t.l}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      </header>

      <div className="flex-1 overflow-hidden">
        <Tabs value={tab} onValueChange={setTab} className="h-full">
          <TabsContent value="overview" className="h-full overflow-auto m-0">
            <ProjectOverview project={project} />
          </TabsContent>
          <TabsContent value="assistant" className="h-full m-0">
            <AssistantSection projectId={projectId} phase={project.phase} />
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
          <TabsContent value="media" className="h-full overflow-auto m-0">
            <MediaSection projectId={projectId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

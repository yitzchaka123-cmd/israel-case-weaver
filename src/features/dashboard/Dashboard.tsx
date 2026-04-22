import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FileText, Users, Layers } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface Project {
  id: string;
  title: string;
  subtitle: string | null;
  cover_image_url: string | null;
  mystery_type: string | null;
  difficulty: string | null;
  phase: string;
  target_doc_count: number | null;
  updated_at: string;
}

export function Dashboard() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,title,subtitle,cover_image_url,mystery_type,difficulty,phase,target_doc_count,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-10">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-1.5">
            Workspace
          </div>
          <h1 className="font-display text-4xl md:text-5xl">Case Archive</h1>
          <p className="text-muted-foreground mt-2">
            Every mystery game you're building, from concept to print.
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      {isLoading ? (
        <SkeletonGrid />
      ) : !projects || projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
          <NewCard />
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav({ to: "/projects/$projectId", params: { projectId: project.id } })}
      className="group text-left bg-card border rounded-2xl overflow-hidden shadow-soft hover:shadow-pop hover:-translate-y-0.5 transition-all"
    >
      <div className="aspect-[4/3] bg-gradient-soft relative overflow-hidden">
        {project.cover_image_url ? (
          <img
            src={project.cover_image_url}
            alt={project.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Layers className="h-10 w-10 opacity-30" />
          </div>
        )}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {project.mystery_type && (
            <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-md bg-surface/90 backdrop-blur">
              {project.mystery_type}
            </span>
          )}
          {project.difficulty && (
            <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-md bg-accent/90 text-accent-foreground">
              {project.difficulty}
            </span>
          )}
        </div>
      </div>
      <div className="p-5">
        <div className="font-display text-xl leading-tight truncate">{project.title}</div>
        {project.subtitle && (
          <div className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{project.subtitle}</div>
        )}
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span className="capitalize">Phase · {project.phase}</span>
          <span>{formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}</span>
        </div>
      </div>
    </button>
  );
}

function NewCard() {
  return (
    <CreateProjectDialog
      trigger={
        <button className="aspect-[4/3] min-h-[280px] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-accent/60 transition-colors">
          <Plus className="h-6 w-6 mb-2" />
          <span className="text-sm font-medium">New case</span>
        </button>
      }
    />
  );
}

function EmptyState() {
  return (
    <div className="border-2 border-dashed rounded-3xl p-16 text-center">
      <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-brand shadow-glow mb-5">
        <FileText className="h-6 w-6 text-white" />
      </div>
      <h3 className="font-display text-2xl">Start your first case</h3>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto">
        Create a new mystery project — you'll be able to plan suspects, documents,
        and the full case board inside.
      </p>
      <div className="mt-6">
        <CreateProjectDialog />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-card border rounded-2xl overflow-hidden">
          <div className="aspect-[4/3] bg-muted animate-pulse" />
          <div className="p-5 space-y-2">
            <div className="h-5 w-3/4 bg-muted animate-pulse rounded" />
            <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateProjectDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();

  const mut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("projects")
        .insert({ title: title || "Untitled Case", subtitle: subtitle || null, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      setTitle("");
      setSubtitle("");
      toast.success("Case created");
      nav({ to: "/projects/$projectId", params: { projectId: data.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2 shadow-glow">
            <Plus className="h-4 w-4" />
            New case
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Open a new case file</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Working title</Label>
            <Input
              autoFocus
              placeholder="e.g. The Tel Aviv Cipher"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Subtitle (optional)</Label>
            <Textarea
              rows={2}
              placeholder="A short hook or tagline"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Creating..." : "Create case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

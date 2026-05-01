import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FileText, Layers, Search, X, SlidersHorizontal, Archive, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { permanentlyDeleteProject, restoreTrashedProject, trashProject } from "@/lib/project-versions";
import { DEFAULT_GAME_LANGUAGE, DEFAULT_GAME_LANGUAGES, normalizeGameLanguage } from "@/lib/game-language";

interface Project {
  id: string;
  title: string;
  subtitle: string | null;
  cover_image_url: string | null;
  mystery_type: string | null;
  genre: string | null;
  difficulty: string | null;
  game_language: string;
  phase: string;
  target_doc_count: number | null;
  updated_at: string;
  deleted_at: string | null;
}

type SortKey = "updated_desc" | "updated_asc" | "title_asc" | "title_desc";

export function Dashboard() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,title,subtitle,cover_image_url,mystery_type,genre,difficulty,game_language,phase,target_doc_count,updated_at,deleted_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  const [query, setQuery] = useState("");
  const [difficulties, setDifficulties] = useState<string[]>([]);
  const [mysteryTypes, setMysteryTypes] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [phases, setPhases] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("updated_desc");
  const [showFilters, setShowFilters] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  // Build option lists from the actual data so users only see filters that
  // can match something. Falls back gracefully when the field is null.
  const options = useMemo(() => {
    const dedupe = (arr: (string | null)[]) =>
      Array.from(new Set(arr.filter((v): v is string => !!v))).sort();
    return {
      difficulty: dedupe(projects?.map((p) => p.difficulty) ?? []),
      mystery_type: dedupe(projects?.map((p) => p.mystery_type) ?? []),
      genre: dedupe(projects?.map((p) => p.genre) ?? []),
      language: dedupe(projects?.map((p) => normalizeGameLanguage(p.game_language)) ?? []),
      phase: dedupe(projects?.map((p) => p.phase) ?? []),
    };
  }, [projects]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    let result = projects.filter((p) => {
      if (showTrash ? !p.deleted_at : p.deleted_at) return false;
      if (q && !`${p.title} ${p.subtitle ?? ""}`.toLowerCase().includes(q)) return false;
      if (difficulties.length && !difficulties.includes(p.difficulty ?? "")) return false;
      if (mysteryTypes.length && !mysteryTypes.includes(p.mystery_type ?? "")) return false;
      if (genres.length && !genres.includes(p.genre ?? "")) return false;
      if (languages.length && !languages.includes(normalizeGameLanguage(p.game_language))) return false;
      if (phases.length && !phases.includes(p.phase)) return false;
      return true;
    });
    result = [...result].sort((a, b) => {
      switch (sort) {
        case "updated_asc": return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
        case "title_asc": return a.title.localeCompare(b.title);
        case "title_desc": return b.title.localeCompare(a.title);
        default: return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });
    return result;
  }, [projects, query, difficulties, mysteryTypes, genres, languages, phases, sort, showTrash]);

  const activeFilterCount =
    difficulties.length + mysteryTypes.length + genres.length + languages.length + phases.length + (query ? 1 : 0);

  const clearAll = () => {
    setQuery("");
    setDifficulties([]);
    setMysteryTypes([]);
    setGenres([]);
    setLanguages([]);
    setPhases([]);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-10">
      <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
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

      {/* Filter bar — shown only when there are any cases at all. */}
      {projects && projects.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title or subtitle…"
                className="pl-9 pr-9"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Button
              variant={showFilters ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
              className="gap-2"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <Button variant={showTrash ? "secondary" : "outline"} size="sm" onClick={() => setShowTrash((v) => !v)} className="gap-2">
              <Archive className="h-3.5 w-3.5" /> Trash
              {projects.some((p) => p.deleted_at) && (
                <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold">
                  {projects.filter((p) => p.deleted_at).length}
                </span>
              )}
            </Button>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">Sort</span>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="h-9 w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated_desc">Recently updated</SelectItem>
                  <SelectItem value="updated_asc">Oldest updated</SelectItem>
                  <SelectItem value="title_asc">Title A → Z</SelectItem>
                  <SelectItem value="title_desc">Title Z → A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {showFilters && (
            <div className="rounded-2xl border bg-card/50 p-4 space-y-4">
              <FilterGroup
                label="Difficulty"
                options={options.difficulty}
                selected={difficulties}
                onChange={setDifficulties}
              />
              <FilterGroup
                label="Mystery type"
                options={options.mystery_type}
                selected={mysteryTypes}
                onChange={setMysteryTypes}
              />
              <FilterGroup
                label="Genre"
                options={options.genre}
                selected={genres}
                onChange={setGenres}
              />
              <FilterGroup
                label="Language"
                options={options.language}
                selected={languages}
                onChange={setLanguages}
              />
              <FilterGroup
                label="Phase"
                options={options.phase}
                selected={phases}
                onChange={setPhases}
                capitalize
              />
              {activeFilterCount > 0 && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="text-xs text-muted-foreground">
                    {filtered.length} of {projects.length} cases match
                  </div>
                  <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs h-7">
                    <X className="h-3 w-3 mr-1" /> Clear all
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <SkeletonGrid />
      ) : !projects || projects.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <NoResultsState onClear={clearAll} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
          {activeFilterCount === 0 && !showTrash && <NewCard />}
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  selected,
  onChange,
  capitalize,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  capitalize?: boolean;
}) {
  if (options.length === 0) return null;
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                capitalize && "capitalize",
                active
                  ? "bg-accent text-accent-foreground border-accent"
                  : "bg-background hover:bg-muted border-border text-foreground/80"
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: () => restoreTrashedProject(project.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Case restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => permanentlyDeleteProject(project.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Case permanently deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const trash = useMutation({
    mutationFn: () => trashProject(project.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Case moved to trash", { description: "You can restore it from the Trash filter." });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="group relative text-left bg-card border rounded-2xl overflow-hidden shadow-soft hover:shadow-pop hover:-translate-y-0.5 transition-all">
      {!project.deleted_at && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Move "${project.title}" to trash? You can restore it later.`)) {
              trash.mutate();
            }
          }}
          disabled={trash.isPending}
          aria-label="Move case to trash"
          className="absolute top-3 right-3 z-10 inline-flex items-center justify-center h-8 w-8 rounded-md bg-surface/90 backdrop-blur text-muted-foreground hover:text-destructive hover:bg-surface opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <button onClick={() => !project.deleted_at && nav({ to: "/projects/$projectId", params: { projectId: project.id } })} className="block w-full text-left disabled:cursor-default" disabled={!!project.deleted_at}>
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
          {project.deleted_at && (
            <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-md bg-destructive text-destructive-foreground">
              Trash
            </span>
          )}
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
          <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-md bg-surface/90 backdrop-blur">
            {normalizeGameLanguage(project.game_language)}
          </span>
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
      {project.deleted_at && (
        <div className="px-5 pb-5 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => restore.mutate()} disabled={restore.isPending} className="gap-1.5 flex-1">
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </Button>
          <Button size="sm" variant="destructive" onClick={() => confirm("Permanently delete this case and its history?") && remove.mutate()} disabled={remove.isPending} className="gap-1.5 flex-1">
            <Trash2 className="h-3.5 w-3.5" /> Delete forever
          </Button>
        </div>
      )}
    </div>
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

function NoResultsState({ onClear }: { onClear: () => void }) {
  return (
    <div className="border-2 border-dashed rounded-3xl p-12 text-center">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-muted mb-4">
        <Search className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl">No cases match your filters</h3>
      <p className="text-muted-foreground mt-1.5 text-sm">
        Try removing a filter or clearing the search.
      </p>
      <div className="mt-5">
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="h-3.5 w-3.5 mr-1.5" /> Clear all filters
        </Button>
      </div>
    </div>
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
  const [gameLanguage, setGameLanguage] = useState(DEFAULT_GAME_LANGUAGE);
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();

  const mut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { data: profile } = await supabase
        .from("profiles")
        .select("default_planning_depth")
        .eq("id", user.id)
        .maybeSingle();
      const planning_depth = (profile as { default_planning_depth?: string } | null)?.default_planning_depth ?? "guided";
      const { data, error } = await supabase
        .from("projects")
        .insert({ title: title || "Untitled Case", subtitle: subtitle || null, owner_id: user.id, game_language: gameLanguage, planning_depth })
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
      setGameLanguage(DEFAULT_GAME_LANGUAGE);
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
          <div className="space-y-1.5">
            <Label>Game language</Label>
            <Select value={gameLanguage} onValueChange={setGameLanguage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEFAULT_GAME_LANGUAGES.map((language) => (
                  <SelectItem key={language} value={language}>{language}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

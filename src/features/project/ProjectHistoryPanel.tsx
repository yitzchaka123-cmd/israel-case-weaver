import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Clock3, Eye, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createProjectVersion, getProjectVersion, listProjectVersions, restoreProjectVersion, type ProjectVersion } from "@/lib/project-versions";
import { toast } from "sonner";

export function ProjectHistoryPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectVersion | null>(null);

  const versions = useQuery({
    queryKey: ["project-versions", projectId],
    queryFn: () => listProjectVersions(projectId),
  });

  const saveVersion = useMutation({
    mutationFn: () => createProjectVersion(projectId, label, "manual"),
    onSuccess: () => {
      setLabel("");
      qc.invalidateQueries({ queryKey: ["project-versions", projectId] });
      toast.success("Version saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreVersion = useMutation({
    mutationFn: (versionId: string) => restoreProjectVersion(versionId),
    onSuccess: () => {
      setPreview(null);
      qc.invalidateQueries();
      toast.success("Version restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openPreview = async (versionId: string) => {
    setPreviewId(versionId);
    try {
      setPreview(await getProjectVersion(versionId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load preview");
    } finally {
      setPreviewId(null);
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Clock3 className="h-3.5 w-3.5" /> History
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Version History</SheetTitle>
          <SheetDescription>Save dated checkpoints, preview them, and restore the whole game if needed.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 rounded-xl border bg-card p-4 space-y-3">
          <Label htmlFor="version-label">Save a checkpoint</Label>
          <div className="flex gap-2">
            <Input id="version-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Before changing ending" />
            <Button onClick={() => saveVersion.mutate()} disabled={saveVersion.isPending} className="gap-2 shrink-0">
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {versions.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading history…</div>
          ) : !versions.data?.length ? (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No saved versions yet.</div>
          ) : (
            versions.data.map((version) => <VersionRow key={version.id} version={version} onPreview={openPreview} loading={previewId === version.id} />)
          )}
        </div>

        <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Preview version</DialogTitle>
              <DialogDescription>This preview will not change anything until you restore it.</DialogDescription>
            </DialogHeader>
            {preview && <VersionPreview version={preview} />}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
              {preview && (
                <Button onClick={() => restoreVersion.mutate(preview.id)} disabled={restoreVersion.isPending} className="gap-2">
                  <RotateCcw className="h-3.5 w-3.5" /> Restore this version
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function VersionRow({ version, onPreview, loading }: { version: ProjectVersion; onPreview: (id: string) => void; loading: boolean }) {
  const summary = version.summary;
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      {summary.cover_image_url ? <img src={summary.cover_image_url} alt={summary.title ?? "Version cover"} className="h-14 w-14 rounded-lg object-cover border" /> : <div className="h-14 w-14 rounded-lg bg-muted border" />}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{version.label || labelForReason(version.reason)}</div>
        <div className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(version.created_at), { addSuffix: true })} · {summary.title ?? "Untitled case"}</div>
        <div className="text-xs text-muted-foreground mt-2">{summary.counts.suspects ?? 0} suspects · {summary.counts.documents ?? 0} docs · {summary.counts.canvas_nodes ?? 0} nodes · {summary.counts.envelopes ?? 0} envelopes · {summary.counts.media_assets ?? 0} media</div>
      </div>
      <Button variant="outline" size="sm" onClick={() => onPreview(version.id)} disabled={loading} className="gap-1.5">
        <Eye className="h-3.5 w-3.5" /> Preview
      </Button>
    </div>
  );
}

function VersionPreview({ version }: { version: ProjectVersion }) {
  const summary = version.summary;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{labelForReason(version.reason)}</div>
        <div className="font-display text-2xl mt-1">{summary.title ?? "Untitled case"}</div>
        {summary.subtitle && <p className="text-sm text-muted-foreground mt-1">{summary.subtitle}</p>}
      </div>
      <PreviewList title="Suspects" items={summary.suspects} />
      <PreviewList title="Documents" items={summary.documents} />
      <PreviewList title="Logic nodes" items={summary.nodes} />
      {summary.marketing && <div className="rounded-xl border p-4"><div className="text-sm font-medium mb-1">Marketing</div><p className="text-sm text-muted-foreground">{summary.marketing}</p></div>}
    </div>
  );
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-xl border p-4"><div className="text-sm font-medium mb-2">{title}</div>{items.length ? <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="text-sm text-muted-foreground">None in this version.</div>}</div>;
}

function labelForReason(reason: string) {
  if (reason === "before_delete") return "Before delete";
  if (reason === "before_restore") return "Before restore";
  if (reason === "auto") return "Auto snapshot";
  return "Manual save";
}
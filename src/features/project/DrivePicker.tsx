// Browse-the-user's-Drive picker. Lists folders and files via the drive-list
// edge function, supports drilling into folders, and returns the selected
// file id via onPick. mimeTypes optionally filters non-folder entries.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, FileIcon, Folder, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };
const FOLDER_MIME = "application/vnd.google-apps.folder";

export function DrivePicker({
  open,
  onOpenChange,
  onPick,
  mimeTypes,
  title = "Pick a file from Google Drive",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (file: DriveFile) => void;
  mimeTypes?: string[];
  title?: string;
}) {
  const [stack, setStack] = useState<{ id: string | null; name: string }[]>([{ id: null, name: "My Drive" }]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  const current = stack[stack.length - 1];

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("drive-list", {
      body: { folderId: current.id, query: query.trim() || null, mimeTypes: mimeTypes ?? null },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Failed to list Drive");
      return;
    }
    setFiles(data?.files ?? []);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current.id]);

  const handlePick = (f: DriveFile) => {
    if (f.mimeType === FOLDER_MIME) {
      setStack((s) => [...s, { id: f.id, name: f.name }]);
      return;
    }
    onPick(f);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-xs flex-wrap">
          {stack.map((s, i) => (
            <div key={`${s.id ?? "root"}-${i}`} className="flex items-center gap-1">
              <button
                className="hover:underline text-muted-foreground"
                onClick={() => setStack(stack.slice(0, i + 1))}
              >
                {s.name}
              </button>
              {i < stack.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Search this folder…"
              className="pl-8 h-9"
            />
          </div>
          <Button onClick={load} variant="outline" size="sm" disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
          </Button>
        </div>

        {/* List */}
        <div className="max-h-[420px] overflow-y-auto border rounded-lg divide-y">
          {loading && files.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading…
            </div>
          ) : files.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No files</div>
          ) : (
            files.map((f) => (
              <button
                key={f.id}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 text-left"
                onClick={() => handlePick(f)}
              >
                {f.mimeType === FOLDER_MIME ? (
                  <Folder className="h-4 w-4 text-accent shrink-0" />
                ) : (
                  <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{f.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{f.mimeType}</div>
                </div>
                {f.mimeType === FOLDER_MIME && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

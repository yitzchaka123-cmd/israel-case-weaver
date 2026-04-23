// Fire-and-forget Drive auto-backup. Calls drive-upload only if the user has a
// connection AND has the auto-backup toggle on. Failures are swallowed (the
// backend records them in user_google_drive_connections.last_error).
import { supabase } from "@/integrations/supabase/client";

export type BackupKind = "document" | "envelope_cover" | "suspect" | "cover" | "media" | "marketing" | "case_export";

const STATUS_CACHE_KEY = "drive-status-cache-v1";
const CACHE_TTL_MS = 30_000;

interface DriveStatus {
  connected: boolean;
  auto_backup_enabled: boolean;
  google_email: string | null;
  last_error: string | null;
}

interface CachedStatus { at: number; status: DriveStatus }

async function getStatus(force = false): Promise<DriveStatus | null> {
  if (!force && typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(STATUS_CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw) as CachedStatus;
        if (Date.now() - c.at < CACHE_TTL_MS) return c.status;
      }
    } catch { /* ignore */ }
  }
  const { data, error } = await supabase.functions.invoke("drive-status", { body: {} });
  if (error) return null;
  const status: DriveStatus = {
    connected: !!data?.connected,
    auto_backup_enabled: !!data?.auto_backup_enabled,
    google_email: data?.google_email ?? null,
    last_error: data?.last_error ?? null,
  };
  if (typeof window !== "undefined") {
    try { sessionStorage.setItem(STATUS_CACHE_KEY, JSON.stringify({ at: Date.now(), status } as CachedStatus)); } catch { /* ignore */ }
  }
  return status;
}

export function invalidateDriveStatusCache() {
  if (typeof window !== "undefined") {
    try { sessionStorage.removeItem(STATUS_CACHE_KEY); } catch { /* ignore */ }
  }
}

const CATEGORY_FOLDER: Record<BackupKind, string> = {
  document: "documents",
  envelope_cover: "envelopes",
  suspect: "suspects",
  cover: "cover",
  media: "media",
  marketing: "marketing",
  case_export: "",
};

export async function backupAsset(opts: {
  projectId: string;
  projectTitle?: string;
  kind: BackupKind;
  assetId: string;
  url: string;
  fileName: string;
  mimeType?: string;
}) {
  try {
    const status = await getStatus();
    if (!status?.connected || !status.auto_backup_enabled) return;
    const safeTitle = (opts.projectTitle || "Untitled Case").replace(/[^\p{L}\p{N}_\- ]+/gu, "_").slice(0, 80);
    const sub = CATEGORY_FOLDER[opts.kind];
    const folderPath = sub
      ? `MyStudio/${safeTitle}/auto-backup/${sub}`
      : `MyStudio/${safeTitle}`;
    await supabase.functions.invoke("drive-upload", {
      body: {
        folderPath,
        fileName: opts.fileName,
        mimeType: opts.mimeType,
        fileUrl: opts.url,
        assetKind: opts.kind,
        projectId: opts.projectId,
        assetId: opts.assetId,
      },
    });
  } catch (e) {
    // Non-blocking — never bubble up to the UI.
    console.warn("[drive-backup] failed", e);
  }
}

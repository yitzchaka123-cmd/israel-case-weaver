// Shared helpers for the per-user Google Drive integration.
// All functions read/write rows in `user_google_drive_connections` via the
// service role client, transparently refreshing access tokens via the stored
// refresh token. Folder paths are auto-created (e.g. "MyStudio/{Case}/auto-backup/documents").
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET") ?? "";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE);
}

export function googleOauthCreds() {
  return { client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET };
}

export interface DriveConnection {
  user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  google_email: string | null;
  scope: string | null;
  auto_backup_enabled: boolean;
  root_folder_id: string | null;
  last_error: string | null;
  last_synced_at: string | null;
}

export async function getConnection(userId: string): Promise<DriveConnection | null> {
  const { data } = await admin()
    .from("user_google_drive_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as DriveConnection | null) ?? null;
}

export async function setLastError(userId: string, message: string | null) {
  await admin()
    .from("user_google_drive_connections")
    .update({ last_error: message, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

// Refreshes the access token using the stored refresh token, updates the row,
// and returns a fresh access token. Throws when there's no refresh token.
export async function refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    await setLastError(userId, `Token refresh failed: ${r.status} ${txt}`);
    throw new Error(`Drive token refresh failed: ${txt}`);
  }
  const j = await r.json();
  const expiresAt = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  await admin()
    .from("user_google_drive_connections")
    .update({
      access_token: j.access_token,
      token_expires_at: expiresAt,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return j.access_token as string;
}

// Returns a valid (non-expired) access token, refreshing if necessary.
export async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await getConnection(userId);
  if (!conn) throw new Error("Drive not connected");
  if (!conn.access_token) throw new Error("No access token stored");
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  // Refresh if expiring within 60 seconds
  if (expiresAt - Date.now() > 60_000) return conn.access_token;
  if (!conn.refresh_token) throw new Error("Token expired and no refresh token");
  return await refreshAccessToken(userId, conn.refresh_token);
}

async function driveFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  return await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers });
}

// Find a folder by exact name under a parent. Returns the folder id or null.
async function findFolder(token: string, name: string, parentId: string | null): Promise<string | null> {
  const safeName = name.replace(/'/g, "\\'");
  const q = parentId
    ? `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
  const url = `files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`;
  const r = await driveFetch(token, url);
  if (!r.ok) throw new Error(`Drive list failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return j.files?.[0]?.id ?? null;
}

async function createFolder(token: string, name: string, parentId: string | null): Promise<string> {
  const r = await driveFetch(token, "files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!r.ok) throw new Error(`Drive folder create failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return j.id as string;
}

// Ensures every segment in folderPath (e.g. "MyStudio/My Case/auto-backup/documents")
// exists, creating missing segments. Returns the leaf folder id.
export async function ensureFolderPath(token: string, folderPath: string): Promise<string> {
  const segments = folderPath.split("/").map((s) => s.trim()).filter(Boolean);
  let parentId: string | null = null;
  for (const seg of segments) {
    let id = await findFolder(token, seg, parentId);
    if (!id) id = await createFolder(token, seg, parentId);
    parentId = id;
  }
  if (!parentId) throw new Error("Empty folder path");
  return parentId;
}

// Sanitises a candidate file name for Drive (removes path separators and trims length).
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/]/g, "_").trim();
  return cleaned.slice(0, 200) || "file";
}

// Uploads bytes to Drive in a target folder. Returns the new file id.
export async function uploadFile(opts: {
  token: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ id: string; name: string }> {
  const boundary = `lovable-${crypto.randomUUID()}`;
  const metadata = {
    name: safeFileName(opts.fileName),
    parents: [opts.folderId],
  };
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + opts.bytes.length + tail.length);
  body.set(head, 0);
  body.set(opts.bytes, head.length);
  body.set(tail, head.length + opts.bytes.length);

  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!r.ok) throw new Error(`Drive upload failed: ${r.status} ${await r.text().catch(() => "")}`);
  return await r.json();
}

export async function listChildren(opts: {
  token: string;
  folderId?: string | null;
  query?: string | null;
  mimeTypes?: string[] | null;
  pageSize?: number;
}): Promise<{ id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }[]> {
  const conditions: string[] = ["trashed=false"];
  if (opts.folderId) conditions.push(`'${opts.folderId}' in parents`);
  else conditions.push(`'root' in parents`);
  if (opts.query) {
    const q = opts.query.replace(/'/g, "\\'");
    conditions.push(`name contains '${q}'`);
  }
  if (opts.mimeTypes?.length) {
    const isFolder = "mimeType='application/vnd.google-apps.folder'";
    const mimes = opts.mimeTypes.map((m) => `mimeType='${m}'`).join(" or ");
    conditions.push(`(${isFolder} or ${mimes})`);
  }
  const q = conditions.join(" and ");
  const url = `files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=${opts.pageSize ?? 100}&orderBy=folder,name`;
  const r = await driveFetch(opts.token, url);
  if (!r.ok) throw new Error(`Drive list failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return j.files ?? [];
}

export async function downloadFileBytes(token: string, fileId: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  // Get metadata first for name+mime
  const metaR = await driveFetch(token, `files/${fileId}?fields=id,name,mimeType`);
  if (!metaR.ok) throw new Error(`Drive metadata failed: ${metaR.status}`);
  const meta = await metaR.json();
  const r = await driveFetch(token, `files/${fileId}?alt=media`);
  if (!r.ok) throw new Error(`Drive download failed: ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  return { bytes: buf, mime: meta.mimeType, name: meta.name };
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

// Resolve the calling user from the Authorization header (uses anon client + JWT).
export async function getUserIdFromAuth(req: Request): Promise<string | null> {
  const u = await getUserFromAuth(req);
  return u?.id ?? null;
}

// Resolve the calling user (id + email) from the Authorization header.
export async function getUserFromAuth(req: Request): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!token) return null;
  const url = SUPABASE_URL;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j?.id) return null;
  return { id: j.id as string, email: (j.email as string | undefined) ?? null };
}

// Uploads bytes to the calling user's Drive at the given folder path.
// Inputs (JSON body):
//   { folderPath: string, fileName: string, mimeType?: string,
//     fileUrl?: string, base64Body?: string,
//     assetKind?: string, projectId?: string, assetId?: string }
//
// If `assetKind`+`projectId`+`assetId` are provided we record/lookup an entry in
// drive_backup_log so a given asset is only uploaded once per user/project.
import { admin, corsHeaders, ensureFolderPath, getUserIdFromAuth, getValidAccessToken, setLastError, uploadFile } from "../_shared/google-drive.ts";

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  const headers = corsHeaders();
  if (req.method === "OPTIONS") return new Response(null, { headers });
  try {
    const userId = await getUserIdFromAuth(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const body = await req.json();
    const folderPath: string = body.folderPath;
    const fileName: string = body.fileName;
    const mimeType: string = body.mimeType ?? "application/octet-stream";
    const fileUrl: string | undefined = body.fileUrl;
    const base64Body: string | undefined = body.base64Body;
    const assetKind: string | undefined = body.assetKind;
    const projectId: string | undefined = body.projectId;
    const assetId: string | undefined = body.assetId;

    if (!folderPath || !fileName) {
      return new Response(JSON.stringify({ error: "folderPath and fileName required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Dedup against backup log
    if (assetKind && projectId && assetId) {
      const { data: existing } = await admin()
        .from("drive_backup_log")
        .select("drive_file_id")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .eq("asset_kind", assetKind)
        .eq("asset_id", assetId)
        .maybeSingle();
      if (existing?.drive_file_id) {
        return new Response(JSON.stringify({ ok: true, skipped: true, drive_file_id: existing.drive_file_id }), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    // Resolve bytes
    let bytes: Uint8Array;
    let resolvedMime = mimeType;
    if (base64Body) {
      bytes = base64ToBytes(base64Body);
    } else if (fileUrl) {
      const r = await fetch(fileUrl);
      if (!r.ok) throw new Error(`fetch fileUrl failed: ${r.status}`);
      bytes = new Uint8Array(await r.arrayBuffer());
      const ct = r.headers.get("content-type");
      if (ct && mimeType === "application/octet-stream") resolvedMime = ct.split(";")[0];
    } else {
      return new Response(JSON.stringify({ error: "Provide fileUrl or base64Body" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const token = await getValidAccessToken(userId);
    const folderId = await ensureFolderPath(token, folderPath);
    const file = await uploadFile({ token, folderId, fileName, mimeType: resolvedMime, bytes });

    if (assetKind && projectId && assetId) {
      await admin()
        .from("drive_backup_log")
        .upsert({
          user_id: userId,
          project_id: projectId,
          asset_kind: assetKind,
          asset_id: assetId,
          drive_file_id: file.id,
          uploaded_at: new Date().toISOString(),
        }, { onConflict: "user_id,project_id,asset_kind,asset_id" });
    }
    await admin()
      .from("user_google_drive_connections")
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("user_id", userId);

    return new Response(JSON.stringify({ ok: true, drive_file_id: file.id, name: file.name }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    try {
      const userId = await getUserIdFromAuth(req);
      if (userId) await setLastError(userId, msg);
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

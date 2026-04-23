// Downloads a Drive file and stores it in a Supabase Storage bucket.
// Inputs: { fileId, targetBucket, targetPath }. Returns { url, name, mime }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, downloadFileBytes, getUserIdFromAuth, getValidAccessToken } from "../_shared/google-drive.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const fileId: string = body.fileId;
    const targetBucket: string = body.targetBucket;
    const targetPath: string = body.targetPath;
    if (!fileId || !targetBucket || !targetPath) {
      return new Response(JSON.stringify({ error: "fileId, targetBucket, targetPath required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const token = await getValidAccessToken(userId);
    const file = await downloadFileBytes(token, fileId);
    const supa = createClient(SUPABASE_URL, SERVICE);
    const { error: upErr } = await supa.storage.from(targetBucket).upload(targetPath, file.bytes, {
      contentType: file.mime,
      upsert: true,
    });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
    const { data } = supa.storage.from(targetBucket).getPublicUrl(targetPath);
    return new Response(JSON.stringify({ url: data.publicUrl, name: file.name, mime: file.mime }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

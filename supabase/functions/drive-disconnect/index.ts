// Revokes the Drive token at Google and deletes the local connection row.
import { admin, corsHeaders, getConnection, getUserIdFromAuth } from "../_shared/google-drive.ts";

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
    const conn = await getConnection(userId);
    if (conn?.refresh_token || conn?.access_token) {
      const tok = conn.refresh_token || conn.access_token;
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok!)}`, {
          method: "POST",
        });
      } catch { /* ignore */ }
    }
    await admin().from("user_google_drive_connections").delete().eq("user_id", userId);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

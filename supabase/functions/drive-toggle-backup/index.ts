// Toggles the auto_backup_enabled flag for the calling user's Drive connection.
import { admin, corsHeaders, getUserIdFromAuth } from "../_shared/google-drive.ts";

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
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
    const enabled = !!body.enabled;
    const { error } = await admin()
      .from("user_google_drive_connections")
      .update({ auto_backup_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, enabled }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

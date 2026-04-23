// Returns whether the calling user has a Drive connection and its current state.
import { corsHeaders, getConnection, getUserIdFromAuth } from "../_shared/google-drive.ts";

Deno.serve(async (req) => {
  const headers = corsHeaders();
  if (req.method === "OPTIONS") return new Response(null, { headers });
  try {
    const userId = await getUserIdFromAuth(req);
    if (!userId) {
      return new Response(JSON.stringify({ connected: false }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const conn = await getConnection(userId);
    return new Response(
      JSON.stringify({
        connected: !!conn?.access_token,
        google_email: conn?.google_email ?? null,
        scope: conn?.scope ?? null,
        auto_backup_enabled: conn?.auto_backup_enabled ?? false,
        last_error: conn?.last_error ?? null,
        last_synced_at: conn?.last_synced_at ?? null,
      }),
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

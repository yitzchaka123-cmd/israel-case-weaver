// Lists files/folders under a Drive folder for the picker UI.
// Inputs: { folderId?, query?, mimeTypes? }
import { corsHeaders, getUserIdFromAuth, getValidAccessToken, listChildren } from "../_shared/google-drive.ts";

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
    const body = await req.json().catch(() => ({}));
    const token = await getValidAccessToken(userId);
    const files = await listChildren({
      token,
      folderId: body.folderId ?? null,
      query: body.query ?? null,
      mimeTypes: body.mimeTypes ?? null,
      pageSize: body.pageSize ?? 100,
    });
    return new Response(JSON.stringify({ files }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

// Returns the Google consent URL for the calling user. The frontend redirects
// the browser to this URL. State carries `<userId>|<returnTo>` so the callback
// can attribute tokens and bounce back to the right page.
import { corsHeaders, DRIVE_SCOPES, getUserIdFromAuth, googleOauthCreds } from "../_shared/google-drive.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

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
    const { client_id } = googleOauthCreds();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "GOOGLE_DRIVE_CLIENT_ID not configured" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const body = (await req.json().catch(() => ({}))) as { returnTo?: string };
    const returnTo = body.returnTo || "/settings";
    const state = `${userId}|${encodeURIComponent(returnTo)}`;
    const redirectUri = `${SUPABASE_URL}/functions/v1/drive-oauth-callback`;
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      scope: DRIVE_SCOPES.join(" "),
      state,
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ url }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

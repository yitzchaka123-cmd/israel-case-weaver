// Returns the Google consent URL for the calling user. The frontend redirects
// the browser to this URL. State carries `<userId>|<returnTo>` so the callback
// can attribute tokens and bounce back to the right page.
//
// We force `prompt=consent select_account` and pass `login_hint=<app email>`
// so Google always shows the account chooser pre-filled with the email the
// user is signed into the app with. This is what stops the silent 403 when
// the browser has multiple Google sessions and Google auto-picks an account
// that is not in the OAuth client's "Test users" list.
import { corsHeaders, DRIVE_SCOPES, getUserFromAuth, googleOauthCreds } from "../_shared/google-drive.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req) => {
  const headers = corsHeaders();
  if (req.method === "OPTIONS") return new Response(null, { headers });
  try {
    const user = await getUserFromAuth(req);
    if (!user) {
      console.warn("[drive-oauth-start] no auth");
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const { client_id } = googleOauthCreds();
    if (!client_id) {
      console.error("[drive-oauth-start] GOOGLE_DRIVE_CLIENT_ID not configured");
      return new Response(JSON.stringify({ error: "GOOGLE_DRIVE_CLIENT_ID not configured" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const body = (await req.json().catch(() => ({}))) as { returnTo?: string; loginHint?: string };
    const returnTo = body.returnTo || "/settings";
    const loginHint = body.loginHint || user.email || "";
    const state = `${user.id}|${encodeURIComponent(returnTo)}`;
    const redirectUri = `${SUPABASE_URL}/functions/v1/drive-oauth-callback`;
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      include_granted_scopes: "true",
      // `consent select_account` together: forces the account chooser AND
      // forces the consent screen so we always get a fresh refresh_token.
      prompt: "consent select_account",
      scope: DRIVE_SCOPES.join(" "),
      state,
    });
    if (loginHint) params.set("login_hint", loginHint);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    console.log("[drive-oauth-start] generated", {
      userId: user.id,
      loginHint: loginHint || null,
      returnTo,
      hasClientId: !!client_id,
    });
    return new Response(JSON.stringify({ url, loginHint }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[drive-oauth-start] error", String((e as Error).message ?? e));
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});

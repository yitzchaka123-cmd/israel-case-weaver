// Receives ?code from Google after user consent, exchanges it for access +
// refresh tokens, fetches the Google email, upserts the connection row keyed
// on user_id, and redirects back to the frontend.
import { admin, googleOauthCreds } from "../_shared/google-drive.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Where to send the user after success. Falls back to the Supabase URL host.
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "";

function pickOrigin(req: Request): string {
  if (APP_ORIGIN) return APP_ORIGIN;
  const ref = req.headers.get("referer");
  if (ref) {
    try { return new URL(ref).origin; } catch { /* ignore */ }
  }
  // Last resort — caller will at least see a JSON page.
  return "";
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error");
  const [userId, returnToEnc] = state.split("|");
  const returnTo = returnToEnc ? decodeURIComponent(returnToEnc) : "/settings";
  const origin = pickOrigin(req);
  const back = (status: "connected" | "error", detail?: string) => {
    if (!origin) {
      return new Response(JSON.stringify({ status, detail }), {
        status: status === "error" ? 400 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const target = `${origin}${returnTo}#drive=${status}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`;
    return Response.redirect(target, 302);
  };

  if (error) return back("error", error);
  if (!code || !userId) return back("error", "missing_code_or_state");

  try {
    const { client_id, client_secret } = googleOauthCreds();
    if (!client_id || !client_secret) return back("error", "oauth_not_configured");

    const redirectUri = `${SUPABASE_URL}/functions/v1/drive-oauth-callback`;
    const body = new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenR = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenR.ok) {
      return back("error", `token_exchange:${tokenR.status}`);
    }
    const tok = await tokenR.json();
    const accessToken = tok.access_token as string;
    const refreshToken = (tok.refresh_token as string | undefined) ?? null;
    const scope = (tok.scope as string | undefined) ?? null;
    const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();

    // Fetch Google email
    let email: string | null = null;
    try {
      const uR = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (uR.ok) {
        const u = await uR.json();
        email = u.email ?? null;
      }
    } catch { /* ignore */ }

    // If we didn't get a refresh token (re-consent without prompt=consent),
    // preserve the existing one so the connection keeps working.
    let preservedRefresh = refreshToken;
    if (!preservedRefresh) {
      const { data: existing } = await admin()
        .from("user_google_drive_connections")
        .select("refresh_token")
        .eq("user_id", userId)
        .maybeSingle();
      preservedRefresh = (existing as { refresh_token: string | null } | null)?.refresh_token ?? null;
    }

    const { error: upErr } = await admin()
      .from("user_google_drive_connections")
      .upsert({
        user_id: userId,
        access_token: accessToken,
        refresh_token: preservedRefresh,
        token_expires_at: expiresAt,
        scope,
        google_email: email,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      });
    if (upErr) return back("error", `db:${upErr.message}`);

    return back("connected");
  } catch (e) {
    return back("error", String((e as Error).message ?? e));
  }
});

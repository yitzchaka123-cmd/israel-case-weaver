import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function codeEmail(code: string) {
  return `code-${code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}@invite.local`;
}

function codePassword(code: string) {
  return `${code}:${SERVICE.slice(0, 48)}:mystery-studio-code-login`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { code: rawCode } = await req.json().catch(() => ({}));
    const code = normalizeCode(String(rawCode ?? ""));
    if (!code) {
      return new Response(JSON.stringify({ error: "Invite code required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE);
    const anon = createClient(SUPABASE_URL, ANON);

    const { data: invite, error: inviteError } = await admin
      .from("invite_codes")
      .select("id, code, label, max_uses, uses, expires_at, revoked_at, code_user_id")
      .eq("code", code)
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) return jsonError("Invalid invite code", 404);
    if (invite.revoked_at) return jsonError("This invite code has been revoked", 403);
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return jsonError("This invite code has expired", 403);
    if (invite.max_uses != null && invite.uses >= invite.max_uses && !invite.code_user_id) return jsonError("This invite code has no logins left", 403);

    const email = codeEmail(code);
    const password = codePassword(code);
    let userId = invite.code_user_id as string | null;

    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: invite.label || `Code ${code}`, login_type: "invite_code" },
      });
      if (created.error) {
        const listed = await admin.auth.admin.listUsers();
        const existing = listed.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (!existing) throw created.error;
        userId = existing.id;
        await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
      } else {
        userId = created.data.user.id;
      }
    } else {
      await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    }

    const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) throw signInError ?? new Error("Could not create code session");

    await admin.rpc("redeem_invite_code", { p_code: code }, {
      headers: { Authorization: `Bearer ${signedIn.session.access_token}` },
    });

    return new Response(JSON.stringify({ session: signedIn.session }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("invite-code-login failed", error);
    return jsonError(error instanceof Error ? error.message : "Invite code login failed", 500);
  }
});

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
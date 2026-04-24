import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

type Body = {
  name?: string;
  skillId?: string;
  fileUrl?: string;
  fileName?: string;
  usageScope?: string[];
};

async function getUserId(req: Request): Promise<string | null> {
  const authH = req.headers.get("Authorization") ?? "";
  const token = authH.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE } });
  if (!r.ok) return null;
  const data = await r.json().catch(() => ({}));
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json() as Body;
    const userId = await getUserId(req);
    if (!userId) return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: roles } = await supa.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").limit(1);
    if (!roles?.length) return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const name = (body.name ?? body.fileName ?? "Custom Claude Skill").trim();
    const localSkillId = (body.skillId ?? name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `skill-${Date.now()}`;
    const usageScope = (body.usageScope ?? ["chat", "documents"]).filter((s) => ["chat", "documents", "marketing", "analysis", "media"].includes(s));

    let remoteSkillId = localSkillId;
    let version = "latest";
    let metadata: Record<string, unknown> = { fileName: body.fileName ?? null, fileUrl: body.fileUrl ?? null };
    let installStatus = "installed";
    let installError: string | null = null;

    if (ANTHROPIC_API_KEY && body.fileUrl) {
      try {
        const fileResp = await fetch(body.fileUrl);
        if (!fileResp.ok) throw new Error(`Could not download uploaded skill package (${fileResp.status})`);
        const blob = await fileResp.blob();
        const form = new FormData();
        form.append("file", blob, body.fileName ?? `${localSkillId}.zip`);
        form.append("name", name);
        const resp = await fetch("https://api.anthropic.com/v1/skills", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "skills-2025-10-02",
          },
          body: form,
        });
        const json = await resp.json().catch(() => ({}));
        metadata = { ...metadata, anthropicResponse: json, anthropicStatus: resp.status };
        if (resp.ok) {
          remoteSkillId = String(json.skill_id ?? json.id ?? localSkillId);
          version = String(json.version ?? "latest");
        } else {
          installStatus = "needs_review";
          installError = String(json?.error?.message ?? json?.message ?? `Claude Skills API returned ${resp.status}`);
        }
      } catch (e) {
        installStatus = "needs_review";
        installError = e instanceof Error ? e.message : String(e);
      }
    } else if (!ANTHROPIC_API_KEY) {
      installStatus = "needs_review";
      installError = "Claude API key is not configured, so the file was saved but not registered remotely.";
    }

    const { data, error } = await supa.from("claude_skills").upsert({
      skill_id: remoteSkillId,
      name,
      description: body.fileName ? `Custom Claude Skill uploaded from ${body.fileName}` : "Custom Claude Skill",
      skill_type: "custom",
      version,
      enabled: installStatus === "installed",
      usage_scope: usageScope.length ? usageScope : ["chat"],
      install_source: "upload",
      uploaded_file_url: body.fileUrl ?? null,
      notes: body.fileName ? `Uploaded file: ${body.fileName}` : null,
      metadata,
      installed_by: userId,
      installed_at: new Date().toISOString(),
      install_status: installStatus,
      install_error: installError,
    }, { onConflict: "skill_id" }).select("*").single();
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, skill: data, installStatus, installError }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Install failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

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

const VALID_SCOPES = ["chat", "documents", "marketing", "analysis", "media"];
const FRONTMATTER_KEYS = [
  "name",
  "description",
  "when_to_use",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "paths",
];

function sanitizeSkillId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function parseScalar(value: string): string | boolean | string[] {
  const clean = value.trim().replace(/^['"]|['"]$/g, "");
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (clean.startsWith("[") && clean.endsWith("]")) {
    return clean.slice(1, -1).split(",").map((v) => v.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  return clean;
}

function parseSkillMarkdown(text: string) {
  const result: Record<string, unknown> = {};
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return result;
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!FRONTMATTER_KEYS.includes(key)) continue;
    result[key] = parseScalar(line.slice(idx + 1));
  }
  return result;
}

function u16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function inspectZip(bytes: Uint8Array) {
  const files: string[] = [];
  let skillText: string | null = null;
  for (let i = 0; i < bytes.length - 46; i++) {
    if (u32(bytes, i) !== 0x02014b50) continue;
    const compression = u16(bytes, i + 10);
    const compressedSize = u32(bytes, i + 20);
    const nameLen = u16(bytes, i + 28);
    const extraLen = u16(bytes, i + 30);
    const commentLen = u16(bytes, i + 32);
    const localOffset = u32(bytes, i + 42);
    const name = new TextDecoder().decode(bytes.slice(i + 46, i + 46 + nameLen));
    files.push(name);
    if (name.toLowerCase().endsWith("skill.md") && compression === 0 && localOffset + 30 < bytes.length) {
      const localNameLen = u16(bytes, localOffset + 26);
      const localExtraLen = u16(bytes, localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      skillText = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(start, start + compressedSize));
    }
    i += 45 + nameLen + extraLen + commentLen;
  }
  return { files, skillText, hasSkill: files.some((f) => f.toLowerCase().endsWith("skill.md")) };
}

function inspectTar(bytes: Uint8Array) {
  const files: string[] = [];
  let skillText: string | null = null;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = decoder.decode(header.slice(0, 100)).replace(/\0.*$/, "");
    const prefix = decoder.decode(header.slice(345, 500)).replace(/\0.*$/, "");
    const fullName = [prefix, name].filter(Boolean).join("/");
    const sizeRaw = decoder.decode(header.slice(124, 136)).replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeRaw || "0", 8) || 0;
    if (fullName) files.push(fullName);
    const start = offset + 512;
    if (fullName.toLowerCase().endsWith("skill.md")) skillText = decoder.decode(bytes.slice(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return { files, skillText, hasSkill: files.some((f) => f.toLowerCase().endsWith("skill.md")) };
}

function textLooksLikeSkillMarkdown(fileName: string, text: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith("skill.md") || (text.includes("---") && /\nname:\s*[-a-z0-9]+/i.test(text) && /\ndescription:\s*/i.test(text));
}

function inspectSkillPackage(fileName: string, arrayBuffer: ArrayBuffer) {
  const lower = fileName.toLowerCase();
  const bytes = new Uint8Array(arrayBuffer);
  const bytesText = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 250_000)));
  if (lower.endsWith(".zip")) return { ...inspectZip(bytes), skillText: inspectZip(bytes).skillText, format: "zip" };
  if (lower.endsWith(".tar")) return { ...inspectTar(bytes), format: "tar" };
  if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) return { files: [], skillText: null, hasSkill: bytesText.includes("SKILL.md") || bytesText.includes("skill.md"), format: "compressed-tar" };
  return { files: [fileName], skillText: bytesText, hasSkill: textLooksLikeSkillMarkdown(fileName, bytesText), format: "markdown" };
}

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

    const requestedName = (body.name ?? body.fileName ?? "Custom Claude Skill").trim().slice(0, 120);
    const localSkillId = sanitizeSkillId(body.skillId ?? requestedName) || `skill-${Date.now()}`;
    const usageScope = (body.usageScope ?? ["chat", "documents"]).filter((s) => VALID_SCOPES.includes(s));

    let remoteSkillId = localSkillId;
    let version = "latest";
    let skillName = requestedName;
    let description = body.fileName ? `Custom Claude Skill uploaded from ${body.fileName}` : "Custom Claude Skill";
    let metadata: Record<string, unknown> = { fileName: body.fileName ?? null, fileUrl: body.fileUrl ?? null, validation: "not_checked" };
    let installStatus = "needs_review";
    let installError: string | null = null;

    if (body.fileUrl) {
      try {
        const fileResp = await fetch(body.fileUrl);
        if (!fileResp.ok) throw new Error(`Could not download uploaded skill package (${fileResp.status})`);
        const blob = await fileResp.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const bytesText = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 250_000)));
        const isValidSkillPackage = packageContainsSkillEntrypoint(body.fileName ?? "", bytesText);
        const frontmatter = textLooksLikeSkillMarkdown(body.fileName ?? "", bytesText) ? parseSkillMarkdown(bytesText) : {};
        const frontmatterName = typeof frontmatter.name === "string" ? sanitizeSkillId(frontmatter.name) : "";
        const frontmatterDescription = typeof frontmatter.description === "string" ? frontmatter.description.slice(0, 800) : "";
        remoteSkillId = frontmatterName || localSkillId;
        skillName = frontmatterName || requestedName;
        description = frontmatterDescription || description;
        metadata = { ...metadata, validation: isValidSkillPackage ? "valid_skill_package" : "missing_skill_md", frontmatter };
        if (!isValidSkillPackage) {
          installStatus = "invalid_package";
          installError = "Claude Skills must be uploaded as a SKILL.md file or a package/archive containing SKILL.md.";
        } else if (!ANTHROPIC_API_KEY) {
          installStatus = "needs_review";
          installError = "Claude API key is not configured, so the Skill package was saved but not registered remotely.";
        } else {
        const form = new FormData();
        form.append("file", new Blob([arrayBuffer]), body.fileName ?? `${localSkillId}.zip`);
        form.append("name", skillName);
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
        const returnedSkillId = String(json.skill_id ?? json.id ?? "");
        if (resp.ok && returnedSkillId) {
          remoteSkillId = sanitizeSkillId(returnedSkillId) || remoteSkillId;
          version = String(json.version ?? "latest");
          installStatus = "installed";
        } else {
          installStatus = "needs_review";
          installError = String(json?.error?.message ?? json?.message ?? `Claude Skills API did not confirm remote skill registration (${resp.status})`);
        }
        }
      } catch (e) {
        installStatus = "needs_review";
        installError = e instanceof Error ? e.message : String(e);
      }
    } else {
      installStatus = "invalid_package";
      installError = "Upload a SKILL.md file or an archive/package containing SKILL.md.";
    }

    const { data, error } = await supa.from("claude_skills").upsert({
      skill_id: remoteSkillId,
      name: skillName,
      description,
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

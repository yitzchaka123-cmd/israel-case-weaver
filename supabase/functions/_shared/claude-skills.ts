export type ClaudeSkillRow = {
  skill_id: string;
  skill_type: string;
  version: string;
  name?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  usage_scope: string[];
};

export function claudeSkillPromptBlock(skills: ClaudeSkillRow[], surface: string) {
  return `AVAILABLE CLAUDE SKILLS FOR ${surface.toUpperCase()}\n${renderClaudeSkillCatalog(skills)}\nIf a listed Skill is relevant, follow its description. Do not mention unavailable, disabled, review-needed, or manual-only skills.`;
}

type SupabaseLike = { from: (table: string) => any };

export async function loadClaudeSkillsForSurface(supa: SupabaseLike, surface: string): Promise<ClaudeSkillRow[]> {
  const { data } = await supa
    .from("claude_skills")
        .select("skill_id, skill_type, version, name, description, metadata, usage_scope")
    .eq("enabled", true)
    .eq("install_status", "installed");
  return ((data ?? []) as ClaudeSkillRow[]).filter((skill) => {
    const metadata = skill.metadata ?? {};
    const frontmatter = (metadata.frontmatter ?? {}) as Record<string, unknown>;
    const anthropicStatus = Number(metadata.anthropicStatus ?? 0);
    const isBuiltInSkill = skill.skill_type === "anthropic";
    const isRegisteredCustomSkill = anthropicStatus >= 200 && anthropicStatus < 300;
    return (
      (skill.usage_scope ?? []).includes(surface) &&
      frontmatter["disable-model-invocation"] !== true &&
      (isBuiltInSkill || isRegisteredCustomSkill)
    );
  });
}

export function renderClaudeSkillCatalog(skills: ClaudeSkillRow[]) {
  if (!skills.length) return "No enabled Claude Skills are installed for this surface.";
  return skills.map((skill) => {
    const metadata = skill.metadata ?? {};
    const frontmatter = (metadata.frontmatter ?? {}) as Record<string, unknown>;
    const when = typeof frontmatter.when_to_use === "string" ? ` Use when: ${frontmatter.when_to_use}` : "";
    return `- /${skill.skill_id} (${skill.skill_type}, v${skill.version || "latest"}): ${skill.description ?? skill.name ?? "Claude Skill"}.${when}`;
  }).join("\n");
}

export function claudeSkillRequestShape(skills: ClaudeSkillRow[]) {
  if (!skills.length) return {};
  // Anthropic Skills require the current code-execution beta + tool version.
  // The legacy 2025-05-22 version is rejected by Sonnet/Opus/Haiku 4.5+.
  return {
    anthropicBeta: "code-execution-2025-08-25,files-api-2025-04-14,skills-2025-10-02",
    anthropicTools: [{ type: "code_execution_20250825", name: "code_execution" }],
    anthropicContainer: {
      skills: skills.map((skill) => ({
        type: skill.skill_type === "anthropic" ? "anthropic" : "custom",
        skill_id: skill.skill_id,
        version: skill.version || "latest",
      })),
    },
  };
}

export function withClaudeSkills(body: Record<string, unknown>, skills: ClaudeSkillRow[]) {
  if (!skills.length) return body;
  return { ...body, ...claudeSkillRequestShape(skills) };
}

export function preferredClaudeDocumentSkill(skills: ClaudeSkillRow[], documentFormat: string): ClaudeSkillRow {
  return skills.find((skill) => skill.skill_id === documentFormat) ?? skills[0] ?? {
    skill_id: documentFormat,
    name: `Claude ${documentFormat.toUpperCase()} Skill`,
    skill_type: "anthropic",
    version: "latest",
    usage_scope: ["documents"],
  };
}
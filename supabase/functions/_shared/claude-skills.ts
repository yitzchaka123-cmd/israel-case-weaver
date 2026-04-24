export type ClaudeSkillRow = {
  skill_id: string;
  skill_type: string;
  version: string;
  name?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  usage_scope: string[];
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => { eq: (column: string, value: unknown) => Promise<{ data: unknown[] | null }> };
    };
  };
};

export async function loadClaudeSkillsForSurface(supa: SupabaseLike, surface: string): Promise<ClaudeSkillRow[]> {
  const { data } = await supa
    .from("claude_skills")
        .select("skill_id, skill_type, version, name, description, metadata, usage_scope")
    .eq("enabled", true)
    .eq("install_status", "installed");
  return ((data ?? []) as ClaudeSkillRow[]).filter((skill) => {
    const metadata = skill.metadata ?? {};
    const frontmatter = (metadata.frontmatter ?? {}) as Record<string, unknown>;
    return (skill.usage_scope ?? []).includes(surface) && frontmatter["disable-model-invocation"] !== true;
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
  return {
    anthropicBeta: "code-execution-2025-05-22,files-api-2025-04-14,skills-2025-10-02",
    anthropicTools: [{ type: "code_execution_20250522", name: "code_execution" }],
    anthropicContainer: {
      skills: skills.map((skill) => ({
        type: skill.skill_type === "anthropic" ? "anthropic" : "custom",
        skill_id: skill.skill_id,
        version: skill.version || "latest",
      })),
    },
  };
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
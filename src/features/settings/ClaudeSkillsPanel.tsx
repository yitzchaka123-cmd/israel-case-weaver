import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Plus, Loader2, FileArchive } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

type ClaudeSkill = {
  id: string;
  skill_id: string;
  name: string;
  skill_type: string;
  version: string;
  enabled: boolean;
  usage_scope: string[];
  install_source: string;
  uploaded_file_url: string | null;
  notes: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  installed_at: string | null;
  install_status: string | null;
  install_error: string | null;
};

const SCOPE_OPTIONS = ["chat", "documents", "marketing", "analysis", "media"];
const BUILT_IN_DESCRIPTIONS: Record<string, string> = {
  pdf: "Create and edit printable PDF documents with Claude code execution.",
  docx: "Create Word/DOCX documents for evidence files and editable print assets.",
  pptx: "Create PowerPoint/PPTX decks for presentations and pitch materials.",
  xlsx: "Create Excel/XLSX spreadsheets for tables, logs, and data-heavy analysis.",
};

export function ClaudeSkillsPanel() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [skillName, setSkillName] = useState("");
  const [skillId, setSkillId] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ["claude-skills"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("claude_skills")
        .select("id, skill_id, name, skill_type, version, enabled, usage_scope, install_source, uploaded_file_url, notes, description, metadata, installed_at, install_status, install_error")
        .order("skill_type", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClaudeSkill[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["claude-skills"] });

  const updateSkill = async (id: string, patch: Partial<ClaudeSkill>) => {
    const { error } = await (supabase as any).from("claude_skills").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const addManualSkill = async () => {
    const cleanName = skillName.trim();
    const cleanId = skillId.trim().toLowerCase().replace(/\s+/g, "-");
    if (!cleanName || !cleanId) return toast.error("Add a skill name and ID");
    const { error } = await (supabase as any).from("claude_skills").insert({
      name: cleanName,
      skill_id: cleanId,
      skill_type: "custom",
      version: "latest",
      enabled: true,
      usage_scope: ["chat"],
      install_source: "settings",
    });
    if (error) toast.error(error.message);
    else {
      setSkillName("");
      setSkillId("");
      toast.success("Claude Skill added");
      refresh();
    }
  };

  const uploadSkill = async (file: File) => {
    if (!isAdmin) return;
    setUploading(true);
    try {
      const inferredId = (skillId.trim() || file.name.replace(/\.[^.]+$/, "")).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      const inferredName = skillName.trim() || file.name.replace(/\.[^.]+$/, "");
      const path = `claude-skills/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("documents").getPublicUrl(path);
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/install-claude-skill`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ name: inferredName, skillId: inferredId, fileUrl: data.publicUrl, fileName: file.name, usageScope: ["chat", "documents"] }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? "Skill install failed");
      setSkillName("");
      setSkillId("");
      toast.success("Claude Skill uploaded");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleScope = (skill: ClaudeSkill, scope: string) => {
    const current = skill.usage_scope ?? [];
    const next = current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope];
    updateSkill(skill.id, { usage_scope: next });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-lg">Claude Skills</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Built-in and custom Skills Claude can use for chat, documents, marketing, and media tasks.
        </p>
      </div>

      {isAdmin && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Skill name">
              <Input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="Game document designer" />
            </Field>
            <Field label="Skill ID">
              <Input value={skillId} onChange={(e) => setSkillId(e.target.value)} placeholder="game-document-designer" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={addManualSkill}>
              <Plus className="h-4 w-4" /> Add skill
            </Button>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadSkill(e.target.files[0])} />
            <Button type="button" variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload skill file
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading Claude Skills…</div>
      ) : (
        <div className="space-y-5">
          <SkillSection title="Claude built-in skills" skills={skills.filter((s) => s.skill_type === "anthropic")} isAdmin={isAdmin} updateSkill={updateSkill} toggleScope={toggleScope} />
          <SkillSection title="Custom Claude Skills" skills={skills.filter((s) => s.skill_type !== "anthropic")} isAdmin={isAdmin} updateSkill={updateSkill} toggleScope={toggleScope} />
        </div>
      )}
    </div>
  );
}

function SkillSection({ title, skills, isAdmin, updateSkill, toggleScope }: { title: string; skills: ClaudeSkill[]; isAdmin: boolean; updateSkill: (id: string, patch: Partial<ClaudeSkill>) => void; toggleScope: (skill: ClaudeSkill, scope: string) => void }) {
  return (
    <section className="space-y-3">
      <h4 className="text-sm font-medium">{title}</h4>
      {skills.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No skills installed here yet.</div>
      ) : (
        <div className="grid gap-3">
          {skills.map((skill) => {
            const description = skill.description ?? BUILT_IN_DESCRIPTIONS[skill.skill_id] ?? skill.notes;
            return (
            <div key={skill.id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-medium truncate">{skill.name}</h4>
                    <Badge variant="secondary">{skill.skill_type === "anthropic" ? "Built-in" : "Custom"}</Badge>
                    <Badge variant="outline">{skill.skill_id}</Badge>
                    {skill.install_status && skill.install_status !== "installed" && <Badge variant="destructive">{skill.install_status}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Version {skill.version} · source {skill.install_source}{skill.installed_at ? ` · installed ${new Date(skill.installed_at).toLocaleDateString()}` : ""}</p>
                  {description && <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{description}</p>}
                </div>
                <Switch checked={skill.enabled} disabled={!isAdmin} onCheckedChange={(checked) => updateSkill(skill.id, { enabled: checked })} />
              </div>
              <div className="flex flex-wrap gap-2">
                {SCOPE_OPTIONS.map((scope) => {
                  const active = skill.usage_scope?.includes(scope);
                  return (
                    <Button key={scope} type="button" size="sm" variant={active ? "default" : "outline"} disabled={!isAdmin} onClick={() => toggleScope(skill, scope)} className="h-7 capitalize">
                      {scope}
                    </Button>
                  );
                })}
              </div>
              {skill.uploaded_file_url && (
                <a href={skill.uploaded_file_url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
                  <FileArchive className="mr-1 inline h-3 w-3" /> Open uploaded skill file
                </a>
              )}
              {skill.install_error && <p className="text-xs text-destructive">{skill.install_error}</p>}
            </div>
          );})}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      {children}
    </label>
  );
}

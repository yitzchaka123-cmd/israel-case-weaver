import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/lib/theme";
import { Sun, Moon, Upload } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { ApiKeyManager } from "./ApiKeyManager";
import { UsageDashboard } from "./UsageDashboard";
import { GeminiConnection } from "./GeminiConnection";
import { AssistantTweaksPanel } from "./AssistantTweaksPanel";
import { AssistantPlaybookPanel } from "./AssistantPlaybookPanel";
import { TeamAccessPanel } from "./TeamAccessPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LOGIC_FLOW_MODELS, LOGIC_FLOW_MODEL_KEY, LOGIC_FLOW_MODEL_DEFAULT } from "@/features/project/CanvasSection";
import { Textarea } from "@/components/ui/textarea";

export function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [planning, setPlanning] = useState("lovable");
  const [documents, setDocuments] = useState("lovable");
  const [images, setImages] = useState("lovable");
  const [imgAssistantInstructions, setImgAssistantInstructions] = useState("");
  const [logicFlowModel, setLogicFlowModel] = useState<string>(() => {
    if (typeof window === "undefined") return LOGIC_FLOW_MODEL_DEFAULT;
    return localStorage.getItem(LOGIC_FLOW_MODEL_KEY) ?? LOGIC_FLOW_MODEL_DEFAULT;
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (profile) {
      setLogoUrl(profile.app_logo_url);
      setDisplayName(profile.display_name ?? "");
      setPlanning(profile.ai_provider_planning);
      setDocuments(profile.ai_provider_documents);
      setImages(profile.ai_provider_images);
      setImgAssistantInstructions((profile as any).image_prompt_assistant_instructions ?? "");
    }
  }, [profile]);

  const save = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: displayName,
      app_logo_url: logoUrl,
      theme,
      ai_provider_planning: planning,
      ai_provider_documents: documents,
      ai_provider_images: images,
      image_prompt_assistant_instructions: imgAssistantInstructions,
    } as any);
    if (error) toast.error(error.message);
    else {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["app-logo", user.id] });
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
    }
  };


  const persistLogoUrl = async (url: string | null) => {
    if (!user) return;
    setLogoUrl(url);
    const { error } = await supabase
      .from("profiles")
      .update({ app_logo_url: url })
      .eq("id", user.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["app-logo", user.id] });
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
  };

  const uploadLogo = async (file: File) => {
    if (!user) return;
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    await persistLogoUrl(data.publicUrl);
    toast.success("Logo uploaded");
  };

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">
      <div className="mb-10">
        <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-1.5">
          Workspace
        </div>
        <h1 className="font-display text-4xl">Settings</h1>
      </div>

      <div className="space-y-8">
        <Section title="Branding" desc="Set your studio logo that appears across the app.">
          <div className="flex items-center gap-5">
            <div className="h-20 w-20 rounded-2xl border bg-muted flex items-center justify-center overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <Upload className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <input
                type="file"
                accept="image/*"
                ref={fileInput}
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              />
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                Upload logo
              </Button>
              {logoUrl && (
                <Button variant="ghost" className="ml-2" onClick={() => persistLogoUrl(null)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </Section>

        <Section title="Appearance" desc="Light or dark theme for your production workspace.">
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            {(["light", "dark"] as const).map((t) => {
              const active = theme === t;
              const Icon = t === "light" ? Sun : Moon;
              return (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={[
                    "p-4 rounded-xl border text-left transition-all",
                    active
                      ? "border-accent ring-2 ring-accent/30 bg-accent/5"
                      : "hover:border-foreground/30",
                  ].join(" ")}
                >
                  <Icon className="h-5 w-5 mb-2" />
                  <div className="font-medium capitalize">{t}</div>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Profile" desc="Your display name in the workspace.">
          <div className="space-y-2 max-w-md">
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        </Section>

        <Section
          title="Image-prompt assistant"
          desc="Global style guide for the AI assistant that drafts image prompts (cover, suspect portraits, document images, media). Applied to every project."
        >
          <Textarea
            rows={8}
            value={imgAssistantInstructions}
            onChange={(e) => setImgAssistantInstructions(e.target.value)}
            placeholder={`e.g. Always cinematic, photo-real, 35mm film grain. Avoid AI-art tropes (oversaturated colors, glossy plastic skin). Prefer single strong focal subject and negative space for title placement. No text or watermarks.`}
            className="font-mono text-xs leading-relaxed"
          />
          <p className="text-[11px] text-muted-foreground mt-2">
            Per-image writer model can be picked next to each "Generate prompt" button. The AI also reads your project's own image style notes (Overview → image_prompt_instructions) on top of this.
          </p>
        </Section>

        <Section
          title="Assistant playbook — defaults"
          desc="These are the assistant's built-in defaults (suspect counts, hint count, envelopes, phase-1 setup order, canonical vocab, realism floor, document-generation mode). Edit any value to change how it builds future cases — without losing the rest of the workflow. Empty / reset = use the system default."
        >
          <AssistantPlaybookPanel />
        </Section>

        <Section
          title="Assistant tweaks"
          desc="Free-form house rules layered ON TOP of the playbook above. Use this for one-off preferences (e.g. 'never use noir genres', 'always include a coded margin doodle'). Talk to the mini-assistant in plain English to add, edit or remove rules — they're injected as USER OVERRIDES."
        >
          <AssistantTweaksPanel />
        </Section>

        <Section title="AI provider routing" desc="Choose which provider handles each task. Each prefix routes to its own billing account — see API keys below.">
          <div className="space-y-3 max-w-xl">
            <ProviderSelectRow
              label="Planning / Game design"
              value={planning}
              onChange={setPlanning}
              options={TEXT_PROVIDER_OPTIONS}
            />
            <ProviderSelectRow
              label="Document generation"
              value={documents}
              onChange={setDocuments}
              options={TEXT_PROVIDER_OPTIONS}
            />
            <ProviderRow
              label="Image generation"
              value={images}
              onChange={setImages}
              providers={["lovable", "openai"]}
            />
          </div>
          <div className="text-xs text-muted-foreground mt-4 space-y-1">
            <p><strong>Lovable AI</strong> entries use the Lovable AI Gateway (workspace credits).</p>
            <p><strong>Direct</strong> entries (Google, OpenAI, Anthropic) bill straight to your own provider account — make sure the matching API key is set in API keys below.</p>
            <p>Image generation: Nano Banana models automatically prefer your GEMINI_API_KEY when present, otherwise fall back to the Lovable AI Gateway. ChatGPT Image always uses your OpenAi key.</p>
          </div>

          <div className="border-t mt-5 pt-5 max-w-xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">Logic Flow generator</div>
                <div className="text-xs text-muted-foreground">
                  Default model for the canvas "Generate logic flow" button. Stored on this device.
                </div>
              </div>
              <Select
                value={logicFlowModel}
                onValueChange={(v) => {
                  setLogicFlowModel(v);
                  localStorage.setItem(LOGIC_FLOW_MODEL_KEY, v);
                  window.dispatchEvent(new StorageEvent("storage", { key: LOGIC_FLOW_MODEL_KEY, newValue: v }));
                  toast.success("Logic Flow default updated");
                }}
              >
                <SelectTrigger className="h-9 text-xs w-[280px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOGIC_FLOW_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section
          title="Google Gemini (Nano Banana)"
          desc="Connect your Google AI Studio API key to call Nano Banana, Nano Banana 2, and Nano Banana Pro directly — bypassing the Lovable AI Gateway and billing to your Google account."
        >
          <GeminiConnection />
        </Section>

        <Section title="Usage & credits" desc="Live spend and quick links to top up each provider. Only OpenAI publishes a usage API; the other providers open their billing dashboards in a new tab.">
          <UsageDashboard />
        </Section>

        <Section title="API keys" desc="Manage and test all API keys this workspace uses to call AI providers.">
          <ApiKeyManager />
        </Section>

        {isAdmin && (
          <Section
            title="Team access"
            desc="Control who can sign in. Create invite codes for new users, then approve them once they sign in with Google."
          >
            <TeamAccessPanel />
          </Section>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={save} className="shadow-glow">Save settings</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border rounded-2xl p-6 shadow-soft">
      <h2 className="font-display text-xl">{title}</h2>
      {desc && <p className="text-sm text-muted-foreground mt-1 mb-5">{desc}</p>}
      {children}
    </section>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  lovable: "Lovable",
  openai: "OpenAI",
  claude: "Claude",
  "gemini-direct-pro": "Gemini",
};

type ProviderOption = { value: string; label: string; header?: boolean };

// Used by Planning / Document rows. Grouped headers (header:true) render as
// non-selectable separators. Every entry maps to a key in the edge functions'
// PROVIDER_MODEL / PLANNING_MODEL maps.
const TEXT_PROVIDER_OPTIONS: ProviderOption[] = [
  { value: "__hdr-lovable", label: "Lovable AI (workspace credits)", header: true },
  { value: "lovable", label: "Lovable default" },
  { value: "gemini-3-pro", label: "Gemini 3.1 Pro (preview)" },
  { value: "gemini-3-flash", label: "Gemini 3 Flash (preview)" },
  { value: "gemini", label: "Gemini 2.5 Pro" },
  { value: "gemini-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "__hdr-direct", label: "Your Google AI key (direct)", header: true },
  { value: "gemini-direct-3-pro", label: "Gemini 3.1 Pro preview (direct)" },
  { value: "gemini-direct-3-flash", label: "Gemini 3 Flash preview (direct)" },
  { value: "gemini-direct-pro", label: "Gemini 2.5 Pro (direct)" },
  { value: "gemini-direct-flash", label: "Gemini 2.5 Flash (direct)" },
  { value: "gemini-direct-flash-lite", label: "Gemini 2.5 Flash Lite (direct)" },
  { value: "__hdr-openai", label: "OpenAI (your OpenAi key)", header: true },
  { value: "openai", label: "GPT-5" },
  { value: "openai-5.4", label: "GPT-5.4" },
  { value: "openai-5.2", label: "GPT-5.2" },
  { value: "openai-mini", label: "GPT-5 mini" },
  { value: "__hdr-claude", label: "Anthropic (your Claude key)", header: true },
  { value: "claude", label: "Claude Sonnet 4.5" },
  { value: "claude-opus", label: "Claude Opus 4.5" },
  { value: "claude-haiku", label: "Claude Haiku 4.5" },
];

function ProviderSelectRow({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: ProviderOption[] }) {
  // If an unknown legacy value is stored, surface a friendly fallback label.
  const known = options.find((o) => !o.header && o.value === value);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="text-sm">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-xs w-[280px] shrink-0">
          <SelectValue placeholder={known?.label ?? value} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) =>
            o.header ? (
              <div
                key={o.value}
                className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {o.label}
              </div>
            ) : (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProviderRow({ label, value, onChange, providers }: { label: string; value: string; onChange: (v: string) => void; providers: string[] }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="text-sm">{label}</div>
      <div className="flex flex-wrap gap-1 p-1 bg-muted rounded-lg">
        {providers.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={[
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              value === p ? "bg-surface shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {PROVIDER_LABEL[p] ?? p}
          </button>
        ))}
      </div>
    </div>
  );
}

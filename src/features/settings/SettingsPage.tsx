import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
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
import { ClaudeSkillsPanel } from "./ClaudeSkillsPanel";
import { TeamAccessPanel } from "./TeamAccessPanel";
import { AiRunLog } from "./AiRunLog";
import { VisibleModelsPanel } from "./VisibleModelsPanel";
import { PromptStudioPanel } from "./PromptStudioPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LOGIC_FLOW_MODELS, LOGIC_FLOW_MODEL_KEY, LOGIC_FLOW_MODEL_DEFAULT } from "@/features/project/CanvasSection";
import { Textarea } from "@/components/ui/textarea";
import { DISPLAY_BACKGROUNDS, DEFAULT_DISPLAY_BACKGROUND, normalizeDisplayBackground } from "@/lib/display-background";
import { useHiddenModels, filterModelOptions } from "@/lib/hidden-models";

const SETTINGS_SECTIONS = [
  { id: "branding", label: "Branding" },
  { id: "appearance", label: "Appearance" },
  { id: "display", label: "Display" },
  { id: "profile", label: "Profile" },
  { id: "image-prompt-assistant", label: "Image prompt assistant" },
  { id: "assistant-rules", label: "Assistant rules" },
  { id: "ai-routing", label: "AI routing" },
  { id: "visible-models", label: "Visible models" },
  { id: "ai-connections", label: "AI connections" },
  { id: "ai-ops", label: "Usage, credits, API keys & activity" },
  { id: "team-access", label: "Team access" },
] as const;

function normalizeSettingsSection(hash: string) {
  const section = hash.replace(/^#/, "");
  if (section === "assistant-playbook" || section === "assistant-tweaks") return "assistant-rules";
  if (section === "usage-credits" || section === "api-keys" || section === "ai-activity-log") return "ai-ops";
  return SETTINGS_SECTIONS.some((item) => item.id === section) ? section : "branding";
}

export function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const loc = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [planning, setPlanning] = useState("openai-5.2");
  const [documents, setDocuments] = useState("lovable");
  const [images, setImages] = useState("lovable");
  const [promptWriter, setPromptWriter] = useState("lovable");
  const [uiBackground, setUiBackground] = useState(DEFAULT_DISPLAY_BACKGROUND);
  const [imgAssistantInstructions, setImgAssistantInstructions] = useState("");
  const [defaultDepth, setDefaultDepth] = useState<"express" | "guided" | "deep">("guided");
  const [logicFlowModel, setLogicFlowModel] = useState<string>(() => {
    if (typeof window === "undefined") return LOGIC_FLOW_MODEL_DEFAULT;
    return localStorage.getItem(LOGIC_FLOW_MODEL_KEY) ?? LOGIC_FLOW_MODEL_DEFAULT;
  });
  const { hidden: hiddenModels } = useHiddenModels();

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
      setPromptWriter((profile as any).ai_provider_prompt_writer ?? "lovable");
      setUiBackground(normalizeDisplayBackground((profile as any).ui_background));
      setImgAssistantInstructions((profile as any).image_prompt_assistant_instructions ?? "");
      const d = (profile as any).default_planning_depth;
      if (d === "express" || d === "guided" || d === "deep") setDefaultDepth(d);
    }
  }, [profile]);

  useEffect(() => {
    document.body.dataset.uiBackground = uiBackground;
  }, [uiBackground]);

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
      ai_provider_prompt_writer: promptWriter,
      ui_background: uiBackground,
      image_prompt_assistant_instructions: imgAssistantInstructions,
      default_planning_depth: defaultDepth,
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

  const section = normalizeSettingsSection(loc.hash);
  const sectionMeta = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  const renderSection = () => {
    switch (section) {
      case "branding":
        return (
          <Section id="branding" title="Branding" desc="Set your studio logo that appears across the app.">
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
        );
      case "appearance":
        return (
          <Section id="appearance" title="Appearance" desc="Light or dark theme for your production workspace.">
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
                      active ? "border-accent ring-2 ring-accent/30 bg-accent/5" : "hover:border-foreground/30",
                    ].join(" ")}
                  >
                    <Icon className="h-5 w-5 mb-2" />
                    <div className="font-medium capitalize">{t}</div>
                  </button>
                );
              })}
            </div>
          </Section>
        );
      case "display":
        return (
          <Section id="display" title="Display" desc="Choose the workspace background saved to your user profile.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {DISPLAY_BACKGROUNDS.map((bg) => {
                const active = uiBackground === bg.value;
                return (
                  <button
                    key={bg.value}
                    type="button"
                    onClick={() => setUiBackground(bg.value)}
                    className={[
                      "rounded-xl border bg-card p-2 text-left transition-all",
                      active ? "border-accent ring-2 ring-accent/30" : "hover:border-foreground/30",
                    ].join(" ")}
                  >
                    <div className={[
                      "h-16 rounded-lg border",
                      bg.previewClass,
                    ].join(" ")} />
                    <div className="mt-2 text-sm font-medium">{bg.label}</div>
                    <div className="text-[11px] text-muted-foreground leading-snug">{bg.desc}</div>
                  </button>
                );
              })}
            </div>
          </Section>
        );
      case "profile":
        return (
          <Section id="profile" title="Profile" desc="Your display name in the workspace.">
            <div className="space-y-2 max-w-md">
              <Label>Display name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          </Section>
        );
      case "image-prompt-assistant":
        return (
          <Section
            id="image-prompt-assistant"
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
        );
      case "assistant-rules":
        return (
          <Section
            id="assistant-rules"
            title="Assistant rules"
            desc="Assistant playbook defaults, Claude Skills, and free-form house rules in one place."
          >
            <div className="space-y-8">
              <AssistantPlaybookPanel />
              <div className="border-t pt-6">
                <ClaudeSkillsPanel />
              </div>
              <div className="border-t pt-6">
                <h3 className="font-display text-lg">Assistant tweaks</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-5">
                  Free-form house rules layered on top of the playbook. Talk to the mini-assistant in plain English to add, edit or remove rules.
                </p>
                <AssistantTweaksPanel />
              </div>
            </div>
          </Section>
        );
      case "ai-routing":
        return (
          <Section id="ai-routing" title="AI provider routing" desc="Choose which provider handles each task. Each prefix routes to its own billing account.">
            <div className="space-y-3 max-w-xl">
              <ProviderSelectRow label="Planning / Game design" value={planning} onChange={setPlanning} options={filterModelOptions(TEXT_PROVIDER_OPTIONS, hiddenModels, planning)} />
              <ProviderSelectRow label="Document generation" value={documents} onChange={setDocuments} options={filterModelOptions(TEXT_PROVIDER_OPTIONS, hiddenModels, documents)} />
              <ProviderSelectRow label="Prompt generation" value={promptWriter} onChange={setPromptWriter} options={filterModelOptions(TEXT_PROVIDER_OPTIONS, hiddenModels, promptWriter)} />
              <ProviderSelectRow label="Image generation" value={images} onChange={setImages} options={filterModelOptions(IMAGE_PROVIDER_OPTIONS, hiddenModels, images)} />
            </div>
            <div className="text-xs text-muted-foreground mt-4 space-y-1">
              <p><strong>Lovable AI</strong> entries use the Lovable AI Gateway (workspace credits).</p>
              <p><strong>Direct</strong> entries (Google, OpenAI, Anthropic) bill straight to your own provider account — make sure the matching API key is set in API keys below.</p>
              <p>Image generation: Nano Banana models automatically prefer your GEMINI_API_KEY when present, otherwise fall back to the Lovable AI Gateway. ChatGPT Image always uses your OpenAi key.</p>
              <p><strong>Prompt generation</strong> drives the "✨ Generate prompt" buttons next to each image (cover, suspects, media, envelopes…). Per-image overrides via the writer-model picker still take precedence.</p>
            </div>
            <div className="border-t mt-5 pt-5 max-w-xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Logic Flow generator</div>
                  <div className="text-xs text-muted-foreground">Default model for the canvas "Generate logic flow" button. Stored on this device.</div>
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
                  <SelectTrigger className="h-9 text-xs w-[280px] shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {filterModelOptions(LOGIC_FLOW_MODELS, hiddenModels, logicFlowModel).map((m) => <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="border-t mt-5 pt-5 max-w-xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Default planning depth</div>
                  <div className="text-xs text-muted-foreground">How deep the assistant interviews you on new projects. You can change it per-project anytime.</div>
                </div>
                <Select value={defaultDepth} onValueChange={(v) => setDefaultDepth(v as "express" | "guided" | "deep")}>
                  <SelectTrigger className="h-9 text-xs w-[280px] shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="express" className="text-xs">⚡ Express — auto-fill &amp; jump to logic flow</SelectItem>
                    <SelectItem value="guided" className="text-xs">🎯 Guided — a few key questions</SelectItem>
                    <SelectItem value="deep" className="text-xs">🔬 Deep Dive — full interview, every detail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Section>
        );
      case "visible-models":
        return (
          <Section
            id="visible-models"
            title="Visible models"
            desc="Trim the long model dropdowns. Hidden models stay fully connected and routable — they just don't show up in the picker menus."
          >
            <VisibleModelsPanel />
          </Section>
        );
      case "ai-connections":
        return (
          <Section
            id="ai-connections"
            title="Google Gemini (Nano Banana)"
            desc="Connect your Google AI Studio API key to call Nano Banana, Nano Banana 2, and Nano Banana Pro directly — bypassing the Lovable AI Gateway and billing to your Google account."
          >
            <GeminiConnection />
          </Section>
        );
      case "ai-ops":
        return (
          <Section id="ai-ops" title="Usage, credits, API keys & activity" desc="Usage dashboards, provider keys, and the full AI activity log in one place.">
            <div className="space-y-8">
              <UsageDashboard />
              <div className="border-t pt-6"><ApiKeyManager /></div>
              <div className="border-t pt-6"><AiRunLog /></div>
            </div>
          </Section>
        );
      case "team-access":
        return isAdmin ? (
          <Section id="team-access" title="Team access" desc="Control who can sign in. Create invite codes for new users, then approve them once they sign in with Google.">
            <TeamAccessPanel />
          </Section>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
      <div className="mb-10">
        <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-1.5">Workspace</div>
        <h1 className="font-display text-4xl">{sectionMeta.label}</h1>
      </div>

      <div className="space-y-8">
        {renderSection()}
        <div className="flex justify-end pt-2">
          <Button onClick={save} className="shadow-glow">Save settings</Button>
        </div>
      </div>
    </div>
  );

}

function Section({ id, title, desc, children }: { id?: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 bg-card border rounded-2xl p-6 shadow-soft">
      <h2 className="font-display text-xl">{title}</h2>
      {desc && <p className="text-sm text-muted-foreground mt-1 mb-5">{desc}</p>}
      {children}
    </section>
  );
}

type ProviderOption = { value: string; label: string; header?: boolean };

// Used by Planning / Document / Prompt-generation rows. Grouped headers
// (header:true) render as non-selectable separators. Every entry maps to a key
// in the edge functions' PROVIDER_MODEL / PLANNING_MODEL maps.
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

// Image provider keys must match generate-image's IMAGE_MODEL map keys
// (chatgpt-image-2, chatgpt-image, nano-banana-pro, nano-banana-2, nano-banana).
// generate-image auto-routes Nano Banana via GEMINI_API_KEY when present,
// otherwise via the Lovable AI Gateway — the "direct" headers below clarify
// which billing account each model lands on for the user.
const IMAGE_PROVIDER_OPTIONS: ProviderOption[] = [
  { value: "__hdr-lovable-img", label: "Lovable AI Gateway (workspace credits)", header: true },
  { value: "lovable", label: "Lovable default (Nano Banana)" },
  { value: "nano-banana-pro", label: "Nano Banana Pro — top quality (Gemini)" },
  { value: "nano-banana-2", label: "Nano Banana 2 — fast (Gemini)" },
  { value: "nano-banana", label: "Nano Banana — classic (Gemini)" },
  { value: "__hdr-openai-img", label: "OpenAI (your OpenAi key)", header: true },
  { value: "chatgpt-image-2", label: "ChatGPT Image 2 (gpt-image-2) — latest" },
  { value: "chatgpt-image", label: "ChatGPT Image 1 (gpt-image-1)" },
  { value: "openai", label: "OpenAI default (ChatGPT Image)" },
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

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/lib/theme";
import { Sun, Moon, Upload } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const fileInput = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [planning, setPlanning] = useState("lovable");
  const [documents, setDocuments] = useState("lovable");
  const [images, setImages] = useState("lovable");

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
    });
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  };

  const uploadLogo = async (file: File) => {
    if (!user) return;
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
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
                <Button variant="ghost" className="ml-2" onClick={() => setLogoUrl(null)}>
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

        <Section title="AI provider routing" desc="Choose which provider handles each task. Images only use OpenAI/Lovable.">
          <div className="space-y-3 max-w-lg">
            <ProviderRow label="Planning / Game design" value={planning} onChange={setPlanning} providers={["lovable", "openai", "claude"]} />
            <ProviderRow label="Document generation" value={documents} onChange={setDocuments} providers={["lovable", "claude", "openai"]} />
            <ProviderRow label="Image generation" value={images} onChange={setImages} providers={["lovable", "openai"]} />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Lovable AI works out of the box. Bring-your-own Claude / OpenAI keys can be
            added later — contact your workspace admin.
          </p>
        </Section>

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

function ProviderRow({ label, value, onChange, providers }: { label: string; value: string; onChange: (v: string) => void; providers: string[] }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm">{label}</div>
      <div className="flex gap-1 p-1 bg-muted rounded-lg">
        {providers.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={[
              "px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors",
              value === p ? "bg-surface shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

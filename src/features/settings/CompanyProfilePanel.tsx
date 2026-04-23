// Workspace-level company profile (one row per user). Stored in
// public.company_profiles, used by every case's Marketing tab and by edge
// functions that need company info (back-of-box prompt, storyboard end-card).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";

interface CompanyProfile {
  owner_id: string;
  company_name: string | null;
  tagline: string | null;
  legal_text: string | null;
  support_email: string | null;
  website: string | null;
  address: string | null;
  country: string | null;
  age_rating: string | null;
  made_in: string | null;
  logo_url: string | null;
  social: Record<string, string>;
}

const EMPTY: Omit<CompanyProfile, "owner_id"> = {
  company_name: "",
  tagline: "",
  legal_text: "",
  support_email: "",
  website: "",
  address: "",
  country: "",
  age_rating: "",
  made_in: "",
  logo_url: "",
  social: {},
};

export function CompanyProfilePanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ["company-profile", user?.id],
    queryFn: async (): Promise<CompanyProfile | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("company_profiles")
        .select("*")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as CompanyProfile) ?? null;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (data) {
      setForm({
        company_name: data.company_name ?? "",
        tagline: data.tagline ?? "",
        legal_text: data.legal_text ?? "",
        support_email: data.support_email ?? "",
        website: data.website ?? "",
        address: data.address ?? "",
        country: data.country ?? "",
        age_rating: data.age_rating ?? "",
        made_in: data.made_in ?? "",
        logo_url: data.logo_url ?? "",
        social: (data.social ?? {}) as Record<string, string>,
      });
    }
  }, [data]);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const updateSocial = (key: string, value: string) => {
    setForm((f) => ({ ...f, social: { ...f.social, [key]: value } }));
  };

  const handleUpload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/company-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
      if (error) {
        toast.error(error.message);
        return;
      }
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      update("logo_url", data.publicUrl);
      toast.success("Logo uploaded");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const payload = { owner_id: user.id, ...form };
    const { error } = await supabase.from("company_profiles").upsert(payload as never, { onConflict: "owner_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["company-profile", user.id] });
      toast.success("Company profile saved");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-5">
        <div className="h-24 w-24 rounded-2xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {form.logo_url ? (
            <img src={form.logo_url} alt="Company logo" className="h-full w-full object-contain" />
          ) : (
            <Upload className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading} className="gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {form.logo_url ? "Replace logo" : "Upload logo"}
          </Button>
          {form.logo_url && (
            <Button variant="ghost" className="ml-2" onClick={() => update("logo_url", "")}>Remove</Button>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Square or wide rectangle works best. Used on box back covers and the storyboard end-card.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Company name" value={form.company_name} onChange={(v) => update("company_name", v)} placeholder="Acme Mysteries Ltd." />
        <Field label="Tagline" value={form.tagline} onChange={(v) => update("tagline", v)} placeholder="Boxed mysteries, beautifully made." />
        <Field label="Support email" value={form.support_email} onChange={(v) => update("support_email", v)} placeholder="hello@acme.com" />
        <Field label="Website" value={form.website} onChange={(v) => update("website", v)} placeholder="https://acme.com" />
        <Field label="Country" value={form.country} onChange={(v) => update("country", v)} placeholder="Israel" />
        <Field label="Made in" value={form.made_in} onChange={(v) => update("made_in", v)} placeholder="Made in Israel" />
        <Field label="Age rating" value={form.age_rating} onChange={(v) => update("age_rating", v)} placeholder="14+" />
        <Field label="Address" value={form.address} onChange={(v) => update("address", v)} placeholder="Street, City, Postal code" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Legal text / footer blurb</Label>
        <Textarea
          rows={3}
          value={form.legal_text ?? ""}
          onChange={(e) => update("legal_text", e.target.value)}
          placeholder={`© ${new Date().getFullYear()} Acme Mysteries Ltd. All rights reserved. Manufactured in Israel.`}
          className="text-sm"
        />
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Social handles (optional)</Label>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          {(["instagram", "x", "tiktok", "youtube"] as const).map((k) => (
            <Field
              key={k}
              label={k}
              value={form.social[k] ?? ""}
              onChange={(v) => updateSocial(k, v)}
              placeholder={`@${k === "x" ? "handle" : "your-brand"}`}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button onClick={save} disabled={saving} className="gap-2 shadow-glow">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save company profile
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string | null; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium capitalize">{label}</Label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="text-sm" />
    </div>
  );
}

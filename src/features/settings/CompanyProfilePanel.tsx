// Workspace-level company profiles. Each user can have multiple profiles
// (e.g. one English brand + one Hebrew brand). Each profile carries its own
// company info, logo, legal text, **reference cover gallery**, and a
// cover-design brief that the AI front-cover designer uses.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Loader2, Plus, Trash2, Star, StarOff, Image as ImageIcon, X } from "lucide-react";
import type { CompanyProfileV2, ReferenceCover } from "@/lib/useActiveCompanyProfile";

const LANGUAGES = ["English", "Hebrew", "Spanish", "French", "German", "Portuguese", "Italian", "Japanese", "Chinese", "Arabic"];

const EMPTY: Omit<CompanyProfileV2, "id" | "owner_id"> = {
  name: "New profile",
  language: "English",
  is_default: false,
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
  phone: "",
  vat_number: "",
  manufactured_by: "",
  distributed_by: "",
  warning_text: "",
  box_footer_line: "",
  social: {},
  reference_covers: [],
  cover_design_brief: "",
};

export function CompanyProfilePanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: profiles } = useQuery({
    queryKey: ["company-profiles-v2", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<CompanyProfileV2[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("company_profiles_v2" as never)
        .select("*")
        .eq("owner_id", user.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CompanyProfileV2[];
    },
  });

  useEffect(() => {
    if (!activeId && profiles && profiles.length) setActiveId(profiles[0].id);
  }, [profiles, activeId]);

  const active = profiles?.find((p) => p.id === activeId) ?? null;

  const addProfile = async () => {
    if (!user) return;
    const isFirst = !profiles?.length;
    const { data, error } = await supabase
      .from("company_profiles_v2" as never)
      .insert({ ...EMPTY, owner_id: user.id, is_default: isFirst, name: isFirst ? "Default profile" : "New profile" } as never)
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["company-profiles-v2", user.id] });
    setActiveId((data as { id: string }).id);
    toast.success("Profile created");
  };

  const deleteProfile = async (id: string) => {
    if (!confirm("Delete this company profile? Cases linked to it will fall back to your default profile.")) return;
    const { error } = await supabase.from("company_profiles_v2" as never).delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["company-profiles-v2", user?.id] });
    setActiveId(null);
  };

  const setDefault = async (id: string) => {
    if (!user) return;
    await supabase.from("company_profiles_v2" as never).update({ is_default: false } as never).eq("owner_id", user.id);
    await supabase.from("company_profiles_v2" as never).update({ is_default: true } as never).eq("id", id);
    qc.invalidateQueries({ queryKey: ["company-profiles-v2", user.id] });
    toast.success("Default updated");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">
            Each profile is a separate brand identity (e.g. English company vs Hebrew company). Pick which one a case ships under in its Packaging tab.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addProfile}>
          <Plus className="h-3.5 w-3.5" /> Add profile
        </Button>
      </div>

      {profiles && profiles.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {profiles.map((p) => {
            const isActive = p.id === activeId;
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                className={[
                  "shrink-0 rounded-xl border px-3 py-2 text-left transition-all min-w-[180px]",
                  isActive ? "border-accent ring-2 ring-accent/30 bg-accent/5" : "hover:border-foreground/30",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  {p.logo_url ? (
                    <img src={p.logo_url} alt="" className="h-8 w-8 rounded border bg-background object-contain" />
                  ) : (
                    <div className="h-8 w-8 rounded border bg-muted flex items-center justify-center">
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {p.name}
                      {p.is_default && <Star className="h-3 w-3 fill-accent text-accent" />}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{p.language}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="border-2 border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">
          No profiles yet. Click <strong>Add profile</strong> to create your first one.
        </div>
      )}

      {active && (
        <ProfileEditor
          key={active.id}
          profile={active}
          onChange={() => qc.invalidateQueries({ queryKey: ["company-profiles-v2", user?.id] })}
          onDelete={() => deleteProfile(active.id)}
          onSetDefault={() => setDefault(active.id)}
        />
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  onChange,
  onDelete,
  onSetDefault,
}: {
  profile: CompanyProfileV2;
  onChange: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const { user } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<CompanyProfileV2>(profile);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingRef, setUploadingRef] = useState(false);

  useEffect(() => { setForm(profile); }, [profile]);

  const update = <K extends keyof CompanyProfileV2>(k: K, v: CompanyProfileV2[K]) => setForm((f) => ({ ...f, [k]: v }));
  const updateSocial = (k: string, v: string) => setForm((f) => ({ ...f, social: { ...(f.social ?? {}), [k]: v } }));

  const handleUploadLogo = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/profile-${profile.id}/logo-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
      if (error) return toast.error(error.message);
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      update("logo_url", data.publicUrl);
      toast.success("Logo uploaded");
    } finally {
      setUploading(false);
    }
  };

  const handleUploadReference = async (file: File) => {
    if (!user) return;
    setUploadingRef(true);
    try {
      const path = `${user.id}/profile-${profile.id}/refs/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
      if (error) return toast.error(error.message);
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      const next: ReferenceCover[] = [...(form.reference_covers ?? []), { url: data.publicUrl, label: file.name, design_notes: "" }];
      update("reference_covers", next);
      toast.success("Reference cover added");
    } finally {
      setUploadingRef(false);
    }
  };

  const removeReference = (idx: number) => {
    const next = (form.reference_covers ?? []).filter((_, i) => i !== idx);
    update("reference_covers", next);
  };

  const updateReference = (idx: number, patch: Partial<ReferenceCover>) => {
    const next = (form.reference_covers ?? []).map((r, i) => (i === idx ? { ...r, ...patch } : r));
    update("reference_covers", next);
  };

  const setDefaultReference = (idx: number) => {
    const list = form.reference_covers ?? [];
    const wasDefault = !!list[idx]?.is_default;
    const next = list.map((r, i) => ({ ...r, is_default: !wasDefault && i === idx }));
    update("reference_covers", next);
  };

  const save = async () => {
    setSaving(true);
    const payload = { ...form };
    const { error } = await supabase
      .from("company_profiles_v2" as never)
      .update(payload as never)
      .eq("id", profile.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    onChange();
    toast.success("Profile saved");
  };

  return (
    <div className="border rounded-2xl p-5 space-y-6 bg-background/40">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="text-base font-display max-w-xs"
            placeholder="Profile name (e.g. Acme EN)"
          />
          <Select value={form.language} onValueChange={(v) => update("language", v)}>
            <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => <SelectItem key={l} value={l} className="text-sm">{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onSetDefault} disabled={profile.is_default}>
            {profile.is_default ? <Star className="h-3.5 w-3.5 fill-accent text-accent" /> : <StarOff className="h-3.5 w-3.5" />}
            {profile.is_default ? "Default" : "Make default"}
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive gap-1.5" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Logo */}
      <div className="flex items-start gap-5">
        <div className="h-24 w-24 rounded-2xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {form.logo_url ? (
            <img src={form.logo_url} alt="Logo" className="h-full w-full object-contain" />
          ) : (
            <Upload className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1">
          <input ref={fileInput} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUploadLogo(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading} className="gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {form.logo_url ? "Replace logo" : "Upload logo"}
          </Button>
          {form.logo_url && (
            <Button variant="ghost" className="ml-2" onClick={() => update("logo_url", "")}>Remove</Button>
          )}
          <p className="text-xs text-muted-foreground mt-2">Used on box back covers and the storyboard end-card.</p>
        </div>
      </div>

      {/* Company info */}
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Company name" value={form.company_name} onChange={(v) => update("company_name", v)} placeholder="Acme Mysteries Ltd." />
        <Field label="Tagline" value={form.tagline} onChange={(v) => update("tagline", v)} placeholder="Boxed mysteries, beautifully made." />
        <Field label="Support email" value={form.support_email} onChange={(v) => update("support_email", v)} placeholder="hello@acme.com" />
        <Field label="Website" value={form.website} onChange={(v) => update("website", v)} placeholder="https://acme.com" />
        <Field label="Phone" value={form.phone} onChange={(v) => update("phone", v)} placeholder="+972 3 555 0100" />
        <Field label="VAT number" value={form.vat_number} onChange={(v) => update("vat_number", v)} placeholder="IL 51-234567-8" />
        <Field label="Country" value={form.country} onChange={(v) => update("country", v)} placeholder="Israel" />
        <Field label="Made in" value={form.made_in} onChange={(v) => update("made_in", v)} placeholder="Made in Israel" />
        <Field label="Manufactured by" value={form.manufactured_by} onChange={(v) => update("manufactured_by", v)} placeholder="Acme Print Works, Tel Aviv" />
        <Field label="Distributed by" value={form.distributed_by} onChange={(v) => update("distributed_by", v)} placeholder="Distributor name & address" />
        <Field label="Age rating" value={form.age_rating} onChange={(v) => update("age_rating", v)} placeholder="14+" />
        <Field label="Address" value={form.address} onChange={(v) => update("address", v)} placeholder="Street, City, Postal code" />
      </div>

      <TextArea label="Warning text (printed on the box)" rows={2} value={form.warning_text}
        onChange={(v) => update("warning_text", v)}
        placeholder="WARNING: Choking hazard — small parts. Not for children under 3." />

      <Field label="Box footer line (optional)" value={form.box_footer_line} onChange={(v) => update("box_footer_line", v)}
        placeholder="e.g. acme.com  ·  @acmemysteries" />

      <TextArea label="Legal text / footer blurb" rows={3} value={form.legal_text}
        onChange={(v) => update("legal_text", v)}
        placeholder={`© ${new Date().getFullYear()} Acme Mysteries Ltd. All rights reserved.`} />

      {/* Cover design brief */}
      <div className="border-t pt-5 space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Cover design brief
        </Label>
        <p className="text-[11px] text-muted-foreground -mt-1">
          The AI cover designer reads this for every case under this profile. Describe your house style:
          typography family, color palette, layout conventions, recurring motifs.
        </p>
        <Textarea
          rows={5}
          value={form.cover_design_brief ?? ""}
          onChange={(e) => update("cover_design_brief", e.target.value)}
          placeholder={`e.g. "Heavy serif title across the top third, photo-real central object on muted noir palette, brand bar across the bottom 8% with the company logo on the left and the tagline on the right…"`}
          className="text-sm"
        />
      </div>

      {/* Reference covers */}
      <div className="border-t pt-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Reference covers
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Upload real game covers whose layout & typography you want each new case cover to mimic. Per-case, you'll pick which reference to anchor on.
            </p>
          </div>
          <input ref={refInput} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUploadReference(e.target.files[0])} />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refInput.current?.click()} disabled={uploadingRef}>
            {uploadingRef ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add reference
          </Button>
        </div>

        {(form.reference_covers ?? []).length === 0 ? (
          <div className="border-2 border-dashed rounded-lg p-6 text-center text-xs text-muted-foreground">
            No reference covers yet.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {(form.reference_covers ?? []).map((r, i) => (
              <div key={`${r.url}-${i}`} className={`rounded-xl border bg-card p-3 flex gap-3 ${r.is_default ? "border-accent ring-2 ring-accent/30" : ""}`}>
                <img src={r.url} alt={r.label ?? `Reference ${i + 1}`} className="h-28 w-20 object-cover rounded border bg-muted shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <Input
                      value={r.label ?? ""}
                      onChange={(e) => updateReference(i, { label: e.target.value })}
                      placeholder="Label"
                      className="text-xs h-7"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-7 w-7 ${r.is_default ? "text-accent" : "text-muted-foreground hover:text-accent"}`}
                      title={r.is_default ? "House default — used when a case has no reference picked" : "Make house default"}
                      onClick={() => setDefaultReference(i)}
                    >
                      <Star className={`h-3.5 w-3.5 ${r.is_default ? "fill-accent" : ""}`} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeReference(i)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    rows={3}
                    value={r.design_notes ?? ""}
                    onChange={(e) => updateReference(i, { design_notes: e.target.value })}
                    placeholder="Design notes — what to imitate from this reference"
                    className="text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Socials */}
      <div className="border-t pt-5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Social handles</Label>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          {(["instagram", "x", "tiktok", "youtube"] as const).map((k) => (
            <Field key={k} label={k} value={(form.social ?? {})[k] ?? ""} onChange={(v) => updateSocial(k, v)} placeholder={`@your-${k}`} />
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-1 sticky bottom-0 bg-background/40 backdrop-blur -mx-5 px-5 -mb-5 pb-5 border-t">
        <Button onClick={save} disabled={saving} className="gap-2 shadow-glow">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save profile
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

function TextArea({ label, value, onChange, rows, placeholder }: { label: string; value: string | null; onChange: (v: string) => void; rows: number; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Textarea rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="text-sm" />
    </div>
  );
}

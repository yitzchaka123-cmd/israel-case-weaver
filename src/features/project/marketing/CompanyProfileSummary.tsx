// Panel D — Read-only view of the **active company profile** for this case.
// Lets the user pick which workspace profile a case ships under and links to
// Settings for full editing.
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Mail, Globe, MapPin, Building2, ImageIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useActiveCompanyProfile, useUserCompanyProfiles } from "@/lib/useActiveCompanyProfile";
import { toast } from "sonner";

export function CompanyProfileSummary({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: profiles } = useUserCompanyProfiles();
  const { data: active } = useActiveCompanyProfile(projectId);

  const setProfile = async (id: string) => {
    const { error } = await supabase.from("projects").update({ company_profile_id: id } as never).eq("id", projectId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["active-company-profile", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    toast.success("Company profile linked");
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-display text-xl">Company profile</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Which brand is this case shipping under? Drives copy language, logo, legal text, and the cover designer.
          </p>
        </div>
        <Link to="/settings" className="text-xs text-accent inline-flex items-center gap-1 hover:underline">
          Manage profiles in Settings <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {profiles && profiles.length > 0 && (
        <div className="flex items-center gap-2 max-w-md">
          <Label className="text-xs text-muted-foreground shrink-0">Active profile</Label>
          <Select value={active?.id ?? ""} onValueChange={setProfile}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Pick a profile" /></SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-sm">
                  {p.name} · {p.language}{p.is_default ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!active ? (
        <div className="border-2 border-dashed rounded-xl p-6 text-center text-sm text-muted-foreground">
          No company profile yet. <Link to="/settings" className="text-accent hover:underline">Create one in Settings</Link>.
        </div>
      ) : (
        <div className="grid md:grid-cols-[auto_1fr] gap-5 items-start">
          <div className="h-24 w-24 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {active.logo_url ? (
              <img src={active.logo_url} alt={active.company_name ?? "Logo"} className="w-full h-full object-contain" />
            ) : (
              <Building2 className="h-7 w-7 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2 min-w-0">
            {active.company_name && <div className="font-display text-lg">{active.company_name}</div>}
            {active.tagline && <div className="text-sm text-muted-foreground italic">"{active.tagline}"</div>}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {active.support_email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {active.support_email}</span>}
              {active.website && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {active.website}</span>}
              {active.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {active.address}</span>}
              {active.country && <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">{active.country}</span>}
              {active.age_rating && <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">Age {active.age_rating}</span>}
              {active.made_in && <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">{active.made_in}</span>}
              <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent">{active.language}</span>
            </div>
            {(active.reference_covers ?? []).length > 0 && (
              <div className="border-t pt-2 mt-2">
                <div className="text-[11px] text-muted-foreground mb-1.5 inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Reference covers ({active.reference_covers.length})</div>
                <div className="flex gap-2 overflow-x-auto">
                  {active.reference_covers.slice(0, 6).map((r, i) => (
                    <img key={i} src={r.url} alt={r.label ?? `Reference ${i + 1}`} className="h-16 w-12 object-cover rounded border bg-muted shrink-0" />
                  ))}
                </div>
              </div>
            )}
            {active.legal_text && (
              <div className="text-[11px] text-muted-foreground border-t pt-2 mt-2 leading-relaxed">{active.legal_text}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

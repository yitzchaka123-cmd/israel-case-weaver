// Panel D — Read-only view of the workspace company profile.
// Editing happens in Settings.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Mail, Globe, MapPin, Building2 } from "lucide-react";

export function CompanyProfileSummary() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["company-profile-readonly", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("company_profiles")
        .select("*")
        .eq("owner_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-soft space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-xl">Company profile</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Inherited from Settings — used on the back of the box and the storyboard end-card.
          </p>
        </div>
        <Link to="/settings" className="text-xs text-accent inline-flex items-center gap-1 hover:underline">
          Edit in Settings <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {!data ? (
        <div className="border-2 border-dashed rounded-xl p-6 text-center text-sm text-muted-foreground">
          No company profile yet. <Link to="/settings" className="text-accent hover:underline">Add one in Settings</Link> so it shows up on every box.
        </div>
      ) : (
        <div className="grid md:grid-cols-[auto_1fr] gap-5 items-start">
          <div className="h-24 w-24 rounded-xl border bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {data.logo_url ? (
              <img src={data.logo_url} alt={data.company_name ?? "Logo"} className="w-full h-full object-contain" />
            ) : (
              <Building2 className="h-7 w-7 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2 min-w-0">
            {data.company_name && <div className="font-display text-lg">{data.company_name}</div>}
            {data.tagline && <div className="text-sm text-muted-foreground italic">"{data.tagline}"</div>}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {data.support_email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {data.support_email}</span>}
              {data.website && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {data.website}</span>}
              {data.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {data.address}</span>}
              {data.country && <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">{data.country}</span>}
              {data.age_rating && <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">Age {data.age_rating}</span>}
              {data.made_in && <span className="px-2 py-0.5 rounded-full bg-muted text-foreground/80">{data.made_in}</span>}
            </div>
            {data.legal_text && (
              <div className="text-[11px] text-muted-foreground border-t pt-2 mt-2 leading-relaxed">{data.legal_text}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

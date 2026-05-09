// Resolves the active company profile for a project: prefers
// projects.company_profile_id → company_profiles_v2 row, falling back to the
// owner's default profile, and finally to any v2 row for that owner. Used by
// every Packaging panel and by Cover & Visuals to know which brand voice,
// language, logo, reference cover and design brief to apply.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export interface ReferenceCover {
  url: string;
  label?: string | null;
  design_notes?: string | null;
}

export interface CompanyProfileV2 {
  id: string;
  owner_id: string;
  name: string;
  language: string;
  is_default: boolean;
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
  phone: string | null;
  vat_number: string | null;
  manufactured_by: string | null;
  distributed_by: string | null;
  warning_text: string | null;
  box_footer_line: string | null;
  social: Record<string, string>;
  reference_covers: ReferenceCover[];
  cover_design_brief: string | null;
}

const SELECT = "*";

export function useUserCompanyProfiles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["company-profiles-v2", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<CompanyProfileV2[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("company_profiles_v2" as never)
        .select(SELECT)
        .eq("owner_id", user.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CompanyProfileV2[];
    },
  });
}

export function useActiveCompanyProfile(projectId: string | undefined) {
  return useQuery({
    queryKey: ["active-company-profile", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<CompanyProfileV2 | null> => {
      if (!projectId) return null;
      const { data: project } = await supabase
        .from("projects")
        .select("owner_id, company_profile_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project) return null;
      const ownerId = (project as { owner_id: string }).owner_id;
      const linkedId = (project as { company_profile_id: string | null }).company_profile_id;

      if (linkedId) {
        const { data } = await supabase
          .from("company_profiles_v2" as never)
          .select(SELECT)
          .eq("id", linkedId)
          .maybeSingle();
        if (data) return data as unknown as CompanyProfileV2;
      }

      const { data: byDefault } = await supabase
        .from("company_profiles_v2" as never)
        .select(SELECT)
        .eq("owner_id", ownerId)
        .eq("is_default", true)
        .maybeSingle();
      if (byDefault) return byDefault as unknown as CompanyProfileV2;

      const { data: any } = await supabase
        .from("company_profiles_v2" as never)
        .select(SELECT)
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      return (any as unknown as CompanyProfileV2) ?? null;
    },
  });
}

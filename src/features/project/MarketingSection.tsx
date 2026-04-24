// Top-level Marketing tab for a project. Stacks five panels.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CoverAndVisuals } from "./marketing/CoverAndVisuals";
import { BoxCopyPanel } from "./marketing/BoxCopyPanel";
import { BarcodeAndBackPanel } from "./marketing/BarcodeAndBackPanel";
import { CompanyProfileSummary } from "./marketing/CompanyProfileSummary";
import { StoryboardStudio } from "./marketing/StoryboardStudio";

export function MarketingSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  useEffect(() => {
    const ch = supabase
      .channel(`marketing-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_marketing", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["project-marketing", projectId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "project_storyboards", filter: `project_id=eq.${projectId}` }, () =>
        qc.invalidateQueries({ queryKey: ["project-storyboards", projectId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "company_profiles" }, () =>
        qc.invalidateQueries({ queryKey: ["company-profile-readonly"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div>
        <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-1">Marketing</div>
        <h2 className="font-display text-3xl">Box, copy & promo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cover art, professional box text, barcode, company info, and a Script → Prompts → Storyboard mini-movie pipeline.
        </p>
      </div>

      <CoverAndVisuals projectId={projectId} />
      <BoxCopyPanel projectId={projectId} />
      <BarcodeAndBackPanel projectId={projectId} />
      <CompanyProfileSummary />
      <StoryboardStudio projectId={projectId} />
    </div>
  );
}

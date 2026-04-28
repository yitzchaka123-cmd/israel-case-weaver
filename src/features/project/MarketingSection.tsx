// Top-level Marketing tab for a project. Stacks five panels.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CoverAndVisuals } from "./marketing/CoverAndVisuals";
import { BoxCopyPanel } from "./marketing/BoxCopyPanel";
import { BarcodeAndBackPanel } from "./marketing/BarcodeAndBackPanel";
import { CompanyProfileSummary } from "./marketing/CompanyProfileSummary";
import { StoryboardStudio } from "./marketing/StoryboardStudio";
import { BatchProgressProvider, useBatchProgress } from "./marketing/BatchProgressContext";
import { BatchProgressPill } from "./marketing/BatchProgressPill";

const marketingNav = [
  { id: "marketing-cover-visuals", label: "Cover & Visuals" },
  { id: "marketing-box-text", label: "Box Text" },
  { id: "marketing-barcode", label: "Barcode" },
  { id: "marketing-company-profile", label: "Company Profile" },
  { id: "marketing-storyboard", label: "Storyboard Studio" },
];

export function MarketingSection({ projectId }: { projectId: string }) {
  return (
    <BatchProgressProvider projectId={projectId}>
      <MarketingSectionInner projectId={projectId} />
    </BatchProgressProvider>
  );
}

function MarketingSectionInner({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const batch = useBatchProgress();

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

      <div className="sticky top-0 z-10 -mx-2 rounded-xl border bg-background/85 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {marketingNav.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>

      {batch && <BatchProgressPill progress={batch.progress} onDismiss={batch.dismiss} />}

      <section id="marketing-cover-visuals" className="scroll-mt-24">
        <CoverAndVisuals projectId={projectId} />
      </section>
      <section id="marketing-box-text" className="scroll-mt-24">
        <BoxCopyPanel projectId={projectId} />
      </section>
      <section id="marketing-barcode" className="scroll-mt-24">
        <BarcodeAndBackPanel projectId={projectId} />
      </section>
      <section id="marketing-company-profile" className="scroll-mt-24">
        <CompanyProfileSummary />
      </section>
      <section id="marketing-storyboard" className="scroll-mt-24">
        <StoryboardStudio projectId={projectId} />
      </section>
    </div>
  );
}

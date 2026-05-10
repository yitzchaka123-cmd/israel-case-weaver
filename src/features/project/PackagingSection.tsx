// Top-level Packaging tab for a project. Box Text leads, then Barcode/Back,
// then Cover & Visuals, then the Company Profile picker, then Storyboard.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CoverAndVisuals } from "./packaging/CoverAndVisuals";
import { BoxCopyPanel } from "./packaging/BoxCopyPanel";
import { BarcodeAndBackPanel } from "./packaging/BarcodeAndBackPanel";
import { CompanyProfileSummary } from "./packaging/CompanyProfileSummary";
import { StoryboardStudio } from "./packaging/StoryboardStudio";
import { BatchProgressProvider, useBatchProgress } from "./packaging/BatchProgressContext";
import { BatchProgressPill } from "./packaging/BatchProgressPill";

const packagingNav = [
  { id: "packaging-box-text", label: "Box Text" },
  { id: "packaging-barcode", label: "Barcode & Back" },
  { id: "packaging-cover-visuals", label: "Cover & Visuals" },
  { id: "packaging-company-profile", label: "Company Profile" },
  { id: "packaging-storyboard", label: "Storyboard Studio" },
];

export function PackagingSection({ projectId }: { projectId: string }) {
  return (
    <BatchProgressProvider projectId={projectId}>
      <PackagingSectionInner projectId={projectId} />
    </BatchProgressProvider>
  );
}

function PackagingSectionInner({ projectId }: { projectId: string }) {
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
      .on("postgres_changes", { event: "*", schema: "public", table: "company_profiles_v2" }, () => {
        qc.invalidateQueries({ queryKey: ["company-profiles-v2"] });
        qc.invalidateQueries({ queryKey: ["active-company-profile", projectId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, qc]);

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 space-y-6">
      <div>
        <div className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground mb-1">Packaging</div>
        <h2 className="font-display text-3xl">Box, copy & promo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Start with the box text — it feeds the back-of-box, then the front cover. Company branding and the storyboard mini-movie come last.
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-2 rounded-xl border bg-background/85 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {packagingNav.map((item) => (
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

      <section id="packaging-box-text" className="scroll-mt-24">
        <BoxCopyPanel projectId={projectId} />
      </section>
      <section id="packaging-barcode" className="scroll-mt-24">
        <BarcodeAndBackPanel projectId={projectId} />
      </section>
      <section id="packaging-cover-visuals" className="scroll-mt-24">
        <CoverAndVisuals projectId={projectId} />
      </section>
      <section id="packaging-company-profile" className="scroll-mt-24">
        <CompanyProfileSummary projectId={projectId} />
      </section>
      <section id="packaging-storyboard" className="scroll-mt-24">
        <StoryboardStudio projectId={projectId} />
      </section>
    </div>
  );
}

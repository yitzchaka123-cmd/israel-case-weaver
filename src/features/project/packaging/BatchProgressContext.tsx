// Context to share a single batch progress tracker across the Marketing tab.
import { createContext, useContext, type ReactNode } from "react";
import { useBatchImageProgress, type BatchProgress, type BatchJobSlot } from "./useBatchImageProgress";

interface Ctx {
  progress: BatchProgress;
  start: (slots: BatchJobSlot[], label: string) => void;
  dismiss: () => void;
}

const BatchProgressContext = createContext<Ctx | null>(null);

export function BatchProgressProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { progress, start, dismiss } = useBatchImageProgress(projectId);
  return (
    <BatchProgressContext.Provider value={{ progress, start, dismiss }}>
      {children}
    </BatchProgressContext.Provider>
  );
}

export function useBatchProgress() {
  return useContext(BatchProgressContext);
}

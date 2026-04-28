// Context to share a single batch progress tracker across the Marketing tab.
import { createContext, useContext, type ReactNode } from "react";
import { useBatchImageProgress, type BatchProgress } from "./useBatchImageProgress";

interface Ctx {
  progress: BatchProgress;
  start: (ids: string[], label: string) => void;
}

const BatchProgressContext = createContext<Ctx | null>(null);

export function BatchProgressProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { progress, start } = useBatchImageProgress(projectId);
  return (
    <BatchProgressContext.Provider value={{ progress, start }}>
      {children}
    </BatchProgressContext.Provider>
  );
}

export function useBatchProgress() {
  return useContext(BatchProgressContext);
}

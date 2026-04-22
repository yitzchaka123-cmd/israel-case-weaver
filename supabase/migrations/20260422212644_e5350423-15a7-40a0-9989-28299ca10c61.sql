-- Add board separation for canvas (logic vs final) and a solution summary on projects
ALTER TABLE public.canvas_nodes
  ADD COLUMN IF NOT EXISTS board text NOT NULL DEFAULT 'logic';

ALTER TABLE public.canvas_edges
  ADD COLUMN IF NOT EXISTS board text NOT NULL DEFAULT 'logic';

CREATE INDEX IF NOT EXISTS idx_canvas_nodes_project_board ON public.canvas_nodes(project_id, board);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_project_board ON public.canvas_edges(project_id, board);

-- Backfill existing rows: anything created before this point belongs to the final board
UPDATE public.canvas_nodes SET board = 'final' WHERE board = 'logic' AND created_at < now();
UPDATE public.canvas_edges SET board = 'final' WHERE board = 'logic' AND created_at < now();

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS solution_summary text,
  ADD COLUMN IF NOT EXISTS logic_approved_at timestamp with time zone;
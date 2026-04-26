ALTER PUBLICATION supabase_realtime ADD TABLE public.canvas_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.canvas_edges;
ALTER TABLE public.canvas_nodes REPLICA IDENTITY FULL;
ALTER TABLE public.canvas_edges REPLICA IDENTITY FULL;
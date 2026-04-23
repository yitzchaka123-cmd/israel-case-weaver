
ALTER TABLE public.suspects
  ADD COLUMN IF NOT EXISTS created_by_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS created_by_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL;

ALTER TABLE public.canvas_nodes
  ADD COLUMN IF NOT EXISTS created_by_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS assistant_origins jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Make chat_messages stream live so the assistant's "thinking" panel updates in real time.
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
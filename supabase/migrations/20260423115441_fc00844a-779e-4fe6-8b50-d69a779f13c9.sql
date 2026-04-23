-- Per-user Google Drive OAuth connections
CREATE TABLE public.user_google_drive_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_google_drive_connections ENABLE ROW LEVEL SECURITY;

-- Users can see whether they have a connection (but tokens stay opaque to clients)
CREATE POLICY "Users can view own drive connection"
  ON public.user_google_drive_connections
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Users can disconnect
CREATE POLICY "Users can delete own drive connection"
  ON public.user_google_drive_connections
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE policy => only service role (edge functions) can write tokens

CREATE TRIGGER update_user_google_drive_connections_updated_at
  BEFORE UPDATE ON public.user_google_drive_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- Editable system prompts (Master + per-surface overrides) with versioning.
CREATE TABLE IF NOT EXISTS public.system_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  surface text NOT NULL,
  body text NOT NULL DEFAULT '',
  injection_mode text NOT NULL DEFAULT 'system_prefix' CHECK (injection_mode IN ('system_prefix', 'system_suffix', 'user_header', 'replace')),
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_prompts_owner_surface_active
  ON public.system_prompts (owner_id, surface, is_active);
CREATE INDEX IF NOT EXISTS idx_system_prompts_owner_surface_version
  ON public.system_prompts (owner_id, surface, version DESC);

-- Only one active version per (owner, surface).
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_prompts_active_one_per_surface
  ON public.system_prompts (owner_id, surface)
  WHERE is_active = true;

ALTER TABLE public.system_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own system_prompts" ON public.system_prompts;
CREATE POLICY "Owners read own system_prompts"
  ON public.system_prompts FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Owners insert own system_prompts" ON public.system_prompts;
CREATE POLICY "Owners insert own system_prompts"
  ON public.system_prompts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owners update own system_prompts" ON public.system_prompts;
CREATE POLICY "Owners update own system_prompts"
  ON public.system_prompts FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Owners delete own system_prompts" ON public.system_prompts;
CREATE POLICY "Owners delete own system_prompts"
  ON public.system_prompts FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'));

-- Touch updated_at on UPDATE.
DROP TRIGGER IF EXISTS trg_system_prompts_updated_at ON public.system_prompts;
CREATE TRIGGER trg_system_prompts_updated_at
  BEFORE UPDATE ON public.system_prompts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Track which prompt versions produced each AI run.
ALTER TABLE public.ai_run_logs
  ADD COLUMN IF NOT EXISTS master_prompt_version integer,
  ADD COLUMN IF NOT EXISTS surface_prompt_version integer;
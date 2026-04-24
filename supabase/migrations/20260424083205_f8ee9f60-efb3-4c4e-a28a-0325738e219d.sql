ALTER TABLE public.invite_codes
ADD COLUMN IF NOT EXISTS code_user_id uuid UNIQUE,
ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code RECORD;
  v_existing RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_existing FROM public.user_access WHERE user_id = v_user_id;
  IF v_existing.status = 'blocked' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'blocked');
  END IF;

  SELECT * INTO v_code FROM public.invite_codes
    WHERE code = upper(trim(p_code))
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF v_code.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'revoked');
  END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  IF v_code.max_uses IS NOT NULL AND v_code.uses >= v_code.max_uses AND v_code.code_user_id IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_uses');
  END IF;
  IF v_code.code_user_id IS NOT NULL AND v_code.code_user_id IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_already_claimed');
  END IF;

  UPDATE public.invite_codes
    SET uses = CASE WHEN code_user_id IS NULL THEN uses + 1 ELSE uses END,
        code_user_id = COALESCE(code_user_id, v_user_id),
        last_login_at = now()
    WHERE id = v_code.id;

  INSERT INTO public.user_access (user_id, status, invite_code_id, approved_at, email, display_name)
  VALUES (
    v_user_id,
    'approved',
    v_code.id,
    now(),
    COALESCE((SELECT email FROM auth.users WHERE id = v_user_id), concat('code-', upper(trim(p_code)), '@invite.local')),
    COALESCE(v_code.label, concat('Code ', upper(trim(p_code))))
  )
  ON CONFLICT (user_id) DO UPDATE
    SET status = 'approved',
        invite_code_id = v_code.id,
        approved_at = COALESCE(public.user_access.approved_at, now()),
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'approved', true);
END;
$$;
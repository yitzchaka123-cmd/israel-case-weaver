
-- 1. Enum for roles
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- 2. user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. invite_codes table
CREATE TABLE public.invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text,
  max_uses integer,
  uses integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

-- 4. user_access table
CREATE TABLE public.user_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','blocked')),
  invite_code_id uuid REFERENCES public.invite_codes(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;

-- 5. has_role security definer (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 6. RLS policies — user_roles
CREATE POLICY "Users read own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. RLS policies — user_access
CREATE POLICY "Users read own access"
  ON public.user_access FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all access"
  ON public.user_access FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage access"
  ON public.user_access FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 8. RLS policies — invite_codes (admin-only)
CREATE POLICY "Admins read invite codes"
  ON public.invite_codes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage invite codes"
  ON public.invite_codes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 9. updated_at trigger for user_access
CREATE TRIGGER user_access_set_updated_at
  BEFORE UPDATE ON public.user_access
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10. Auto-create pending user_access row on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_access (user_id, status, email, display_name)
  VALUES (
    NEW.id,
    'pending',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_access ON auth.users;
CREATE TRIGGER on_auth_user_created_access
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_access();

-- 11. redeem_invite_code function
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

  -- Already approved? skip
  SELECT * INTO v_existing FROM public.user_access WHERE user_id = v_user_id;
  IF v_existing.status = 'approved' THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true);
  END IF;
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
  IF v_code.max_uses IS NOT NULL AND v_code.uses >= v_code.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_uses');
  END IF;

  UPDATE public.invite_codes
    SET uses = uses + 1
    WHERE id = v_code.id;

  -- Attach the code to the user_access row but keep status pending until admin approves
  UPDATE public.user_access
    SET invite_code_id = v_code.id, updated_at = now()
    WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'pending_approval', true);
END;
$$;

-- 12. Admin action: set user status
CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_status NOT IN ('pending','approved','blocked') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  UPDATE public.user_access
    SET status = p_status,
        approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END,
        approved_by = CASE WHEN p_status = 'approved' THEN auth.uid() ELSE approved_by END,
        updated_at = now()
    WHERE user_id = p_user_id;
END;
$$;

-- 13. Admin action: toggle admin role (with last-admin guard)
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_grant THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role)
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF p_role = 'admin' THEN
      SELECT COUNT(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin';
      IF v_admin_count <= 1 THEN
        RAISE EXCEPTION 'cannot_remove_last_admin';
      END IF;
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$$;

-- 14. Seed the existing user as approved admin
INSERT INTO public.user_access (user_id, status, approved_at, email, display_name)
  SELECT id, 'approved', now(), email,
    COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email,'@',1))
  FROM auth.users
  ON CONFLICT (user_id) DO UPDATE SET status = 'approved', approved_at = now();

INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'admin'::public.app_role FROM auth.users
  ON CONFLICT (user_id, role) DO NOTHING;

-- 15. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_access;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invite_codes;

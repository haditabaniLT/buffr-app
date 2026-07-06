-- ── 1. Block role self-escalation ────────────────────────────────────────────
-- users.role now lives directly on the users table. The protect-sensitive
-- trigger was never updated to block it, so any authenticated user could
-- promote themselves via UPDATE users SET role = 'parent'.
CREATE OR REPLACE FUNCTION public.users_block_sensitive_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (auth.role() = 'service_role') OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot change user id';
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'Cannot change parent_id';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Cannot change email here; update via auth instead';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Cannot change role; contact support';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Fix handle_new_user: read role from user_metadata (raw_user_meta_data) ─
-- children-server.ts sets role in user_metadata, NOT app_metadata.
-- The old trigger read from raw_app_meta_data->>'role' which was always NULL,
-- so provisioned child accounts were silently created as 'parent' first.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role  public.app_role;
  _name  text;
  _phone text;
BEGIN
  IF NEW.raw_app_meta_data->>'provisioned' = 'true'
     AND (NEW.raw_user_meta_data->>'role') IS NOT NULL THEN
    _role := (NEW.raw_user_meta_data->>'role')::public.app_role;
  ELSIF EXISTS (
    SELECT 1 FROM public.invitations
    WHERE email = NEW.email AND status = 'pending'
  ) THEN
    _role := 'child';
  ELSE
    _role := 'parent';
  END IF;

  _name  := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  _phone := NEW.raw_user_meta_data->>'phone';

  INSERT INTO public.users (id, email, name, phone, role)
  VALUES (NEW.id, NEW.email, _name, _phone, _role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        name  = COALESCE(NULLIF(EXCLUDED.name, ''), public.users.name),
        phone = COALESCE(EXCLUDED.phone, public.users.phone),
        role  = EXCLUDED.role;

  RETURN NEW;
END;
$$;

-- ── 3. Optimise admin_list_users: use users.role directly (no per-row RPC) ───
-- Must DROP first because the return type (added role column) changed.
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id         uuid,
  name       text,
  email      text,
  phone      text,
  status     text,
  role       text,
  parent_id  uuid,
  parent_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.name,
    u.email,
    u.phone,
    u.status,
    u.role::text,
    u.parent_id,
    p.name AS parent_name,
    u.created_at
  FROM public.users u
  LEFT JOIN public.users p ON p.id = u.parent_id
  WHERE u.role <> 'admin'
  ORDER BY u.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, authenticated;

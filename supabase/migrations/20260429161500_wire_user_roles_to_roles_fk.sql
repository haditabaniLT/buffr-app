-- Wire user_roles.role_id as a proper FK to the roles lookup table.
-- Idempotent: safe to re-run if partially applied.
--
-- Sequence:
--   1. Add role_id column (nullable for now so we can backfill)
--   2. Backfill from existing app_role enum values via roles.name match
--      (skipped if role column was already dropped in a prior partial run)
--   3. Add NOT NULL + FK constraint
--   4. Swap unique constraint from (user_id, role) → (user_id, role_id)
--   5. Drop old enum column (IF EXISTS — safe to re-run)
--   6. Re-create has_role / get_primary_role / handle_new_user / accept_invitation
--      to use the role_id join instead of the enum column

-- ── Step 1: add role_id ──────────────────────────────────────────────────────
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role_id smallint;

-- ── Step 2: backfill — only if the old `role` enum column still exists ───────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_roles'
      AND column_name  = 'role'
  ) THEN
    UPDATE public.user_roles ur
    SET role_id = r.id
    FROM public.roles r
    WHERE lower(r.name) = ur.role::text
      AND ur.role_id IS NULL;
  ELSE
    -- role column already dropped; backfill from existing role_id values is a no-op.
    -- If role_id is still NULL for some rows we can't recover the original role,
    -- so just assign 'Parent' (id=2) as a safe default for any orphaned rows.
    UPDATE public.user_roles
    SET role_id = (SELECT id FROM public.roles WHERE lower(name) = 'parent' LIMIT 1)
    WHERE role_id IS NULL;
  END IF;
END;
$$;

-- ── Step 3: enforce NOT NULL + FK ────────────────────────────────────────────
ALTER TABLE public.user_roles ALTER COLUMN role_id SET NOT NULL;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_id_fkey;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_id_fkey
  FOREIGN KEY (role_id) REFERENCES public.roles(id);

-- ── Step 4: swap unique constraint ───────────────────────────────────────────
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_id_key;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);

-- ── Step 5: drop old enum column (IF EXISTS — idempotent) ────────────────────
ALTER TABLE public.user_roles DROP COLUMN IF EXISTS role;

-- ── Step 6a: has_role ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND lower(r.name) = _role::text
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- ── Step 6b: get_primary_role ─────────────────────────────────────────────────
-- Roles sorted by id ASC: Admin(1) > Parent(2) > Child(3)
CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT lower(r.name)::public.app_role
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = _user_id
  ORDER BY ur.role_id ASC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO authenticated;

-- ── Step 6c: handle_new_user ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role      public.app_role := 'parent';
  _is_prov   boolean         := coalesce((new.raw_app_meta_data->>'provisioned')::boolean, false);
  _meta_role text;
BEGIN
  INSERT INTO public.users (id, name, email, phone)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    new.raw_user_meta_data->>'phone'
  );

  IF _is_prov THEN
    _meta_role := new.raw_user_meta_data->>'role';
    IF _meta_role IN ('admin', 'parent', 'child') THEN
      _role := _meta_role::public.app_role;
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id)
  SELECT new.id, r.id FROM public.roles r WHERE lower(r.name) = _role::text;

  RETURN new;
END;
$$;

-- ── Step 6d: accept_invitation ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _invite          public.invitations;
  _uid             uuid;
  _email           text;
  _existing_parent uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Admins cannot accept child invitations';
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid;

  SELECT * INTO _invite
  FROM public.invitations
  WHERE token = _token AND status = 'pending' AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired invitation'; END IF;

  IF lower(_invite.email) <> lower(_email) THEN
    RAISE EXCEPTION 'This invitation was issued to a different email address';
  END IF;

  SELECT parent_id INTO _existing_parent FROM public.users WHERE id = _uid;
  IF _existing_parent IS NOT NULL AND _existing_parent <> _invite.parent_id THEN
    RAISE EXCEPTION 'You are already linked to a parent';
  END IF;

  ALTER TABLE public.users DISABLE TRIGGER users_protect_sensitive;
  UPDATE public.users SET parent_id = _invite.parent_id WHERE id = _uid;
  ALTER TABLE public.users ENABLE TRIGGER users_protect_sensitive;

  INSERT INTO public.user_roles (user_id, role_id)
  SELECT _uid, r.id FROM public.roles r WHERE lower(r.name) = 'child'
  ON CONFLICT (user_id, role_id) DO NOTHING;

  UPDATE public.invitations
    SET status = 'accepted', accepted_user_id = _uid
    WHERE id = _invite.id;

  RETURN _invite.parent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;

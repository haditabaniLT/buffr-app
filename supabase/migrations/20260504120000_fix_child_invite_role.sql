-- Fix: invited children receiving parent role instead of child role.
--
-- Root causes:
--   1. get_primary_role ordered by role_id ASC → parent (id=2) outranks child (id=3)
--   2. accept_invitation only added child role, never removed existing parent role
--   3. handle_new_user defaulted to 'parent' if provisioned flag was absent
--
-- Fixes applied:
--   A. get_primary_role: explicit priority (admin=1, child=2, parent=3)
--   B. accept_invitation: DELETE all non-child roles before inserting child
--   C. handle_new_user: check pending invitations as a safety-net when provisioned not set
--   D. Backfill: strip parent role from any user who already has the child role

-- ── A: get_primary_role ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT lower(r.name)::public.app_role
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = _user_id
  ORDER BY CASE lower(r.name)
    WHEN 'admin'  THEN 1
    WHEN 'child'  THEN 2
    WHEN 'parent' THEN 3
    ELSE 4
  END
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO authenticated;

-- ── B: accept_invitation ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _invite          public.invitations;
  _uid             uuid;
  _email           text;
  _child_role_id   smallint;
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
    RAISE EXCEPTION 'You are already linked to a different parent';
  END IF;

  SELECT id INTO _child_role_id FROM public.roles WHERE lower(name) = 'child' LIMIT 1;

  -- ❶ Strip any non-child roles (e.g. the default 'parent' row from handle_new_user)
  DELETE FROM public.user_roles
  WHERE user_id = _uid
    AND role_id <> _child_role_id;

  -- ❷ Assign child role
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (_uid, _child_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  -- ❸ Link to parent
  ALTER TABLE public.users DISABLE TRIGGER users_protect_sensitive;
  UPDATE public.users SET parent_id = _invite.parent_id WHERE id = _uid;
  ALTER TABLE public.users ENABLE TRIGGER users_protect_sensitive;

  -- ❹ Mark invitation accepted
  UPDATE public.invitations
    SET status = 'accepted', accepted_user_id = _uid
    WHERE id = _invite.id;

  RETURN _invite.parent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;

-- ── C: handle_new_user ─────────────────────────────────────────────────────────
-- Safety-net: if a user registers via client-side signUp (no provisioned flag)
-- and their email matches a pending invitation, assign 'child' instead of 'parent'.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role       public.app_role := 'parent';
  _is_prov    boolean         := coalesce((new.raw_app_meta_data->>'provisioned')::boolean, false);
  _meta_role  text;
  _has_invite boolean         := false;
BEGIN
  INSERT INTO public.users (id, name, email, phone)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    new.raw_user_meta_data->>'phone'
  );

  IF _is_prov THEN
    -- Admin-created user: trust the role declared in user_metadata
    _meta_role := new.raw_user_meta_data->>'role';
    IF _meta_role IN ('admin', 'parent', 'child') THEN
      _role := _meta_role::public.app_role;
    END IF;
  ELSE
    -- Self-registered user: check for a pending invitation matching this email
    SELECT EXISTS (
      SELECT 1 FROM public.invitations
      WHERE lower(email) = lower(new.email)
        AND status = 'pending'
        AND expires_at > now()
    ) INTO _has_invite;
    IF _has_invite THEN
      _role := 'child';
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id)
  SELECT new.id, r.id FROM public.roles r WHERE lower(r.name) = _role::text;

  RETURN new;
END;
$$;

-- ── D: Backfill ────────────────────────────────────────────────────────────────
-- Remove the parent role from every user who also has the child role.
-- This fixes any existing accounts affected by the previous bug.
DELETE FROM public.user_roles
WHERE role_id = (SELECT id FROM public.roles WHERE lower(name) = 'parent' LIMIT 1)
  AND user_id IN (
    SELECT user_id FROM public.user_roles
    WHERE role_id = (SELECT id FROM public.roles WHERE lower(name) = 'child' LIMIT 1)
  );

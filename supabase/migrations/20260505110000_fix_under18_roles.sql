-- Fix existing under-18 child accounts that were assigned 'parent' role by
-- handle_new_user (trigger did not receive app_metadata.provisioned in time).
--
-- Identification heuristic:
--   A user is a minor-child if:
--     • parent_id IS NOT NULL  (they are someone's child)
--     • no ACCEPTED invitation exists for their email
--       (18+ children go through the invite flow; under-18 are created directly)
--
-- This is safe: 18+ children who accepted invites are excluded;
-- parent users have no parent_id and are not touched.

DO $$
DECLARE
  _child_role_id  smallint;
  _parent_role_id smallint;
BEGIN
  SELECT id INTO _child_role_id  FROM public.roles WHERE lower(name) = 'child'  LIMIT 1;
  SELECT id INTO _parent_role_id FROM public.roles WHERE lower(name) = 'parent' LIMIT 1;

  -- ❶ Mark qualifying users as is_minor = true (backfill the column)
  UPDATE public.users u
  SET is_minor = true
  WHERE u.parent_id IS NOT NULL
    AND u.is_minor = false
    AND NOT EXISTS (
      SELECT 1 FROM public.invitations i
      WHERE lower(i.email) = lower(u.email)
        AND i.status = 'accepted'
    );

  -- ❷ Remove parent role from those users
  DELETE FROM public.user_roles
  WHERE role_id = _parent_role_id
    AND user_id IN (SELECT id FROM public.users WHERE is_minor = true);

  -- ❸ Ensure child role exists for those users
  INSERT INTO public.user_roles (user_id, role_id)
  SELECT u.id, _child_role_id
  FROM public.users u
  WHERE u.is_minor = true
  ON CONFLICT (user_id, role_id) DO NOTHING;
END;
$$;

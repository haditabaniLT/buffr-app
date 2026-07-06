-- Fix accept_invitation: rewrite to use users.role directly instead of
-- the dropped user_roles + roles tables.
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    RAISE EXCEPTION 'You are already linked to a different parent';
  END IF;

  -- Set role to child and link to parent in one update (trigger disabled to allow parent_id write)
  ALTER TABLE public.users DISABLE TRIGGER users_protect_sensitive;
  UPDATE public.users
    SET role = 'child', parent_id = _invite.parent_id, is_minor = false
    WHERE id = _uid;
  ALTER TABLE public.users ENABLE TRIGGER users_protect_sensitive;

  -- Mark invitation accepted
  UPDATE public.invitations
    SET status = 'accepted', accepted_user_id = _uid
    WHERE id = _invite.id;

  RETURN _invite.parent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;

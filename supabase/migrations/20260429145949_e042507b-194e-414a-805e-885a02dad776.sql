CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _invite public.invitations;
  _uid uuid;
  _email text;
  _existing_parent uuid;
begin
  _uid := auth.uid();
  if _uid is null then raise exception 'Not authenticated'; end if;

  if public.has_role(_uid, 'admin') then
    raise exception 'Admins cannot accept child invitations';
  end if;

  select email into _email from auth.users where id = _uid;

  select * into _invite from public.invitations
    where token = _token and status = 'pending' and expires_at > now()
    for update;
  if not found then raise exception 'Invalid or expired invitation'; end if;

  if lower(_invite.email) <> lower(_email) then
    raise exception 'This invitation was issued to a different email address';
  end if;

  select parent_id into _existing_parent from public.users where id = _uid;
  if _existing_parent is not null and _existing_parent <> _invite.parent_id then
    raise exception 'You are already linked to a parent';
  end if;

  alter table public.users disable trigger users_protect_sensitive;
  update public.users set parent_id = _invite.parent_id where id = _uid;
  alter table public.users enable trigger users_protect_sensitive;

  delete from public.user_roles where user_id = _uid and role <> 'child';
  insert into public.user_roles (user_id, role) values (_uid, 'child')
    on conflict (user_id, role) do nothing;

  -- Delete the invitation now that it has been accepted.
  delete from public.invitations where id = _invite.id;

  return _invite.parent_id;
end;
$function$;
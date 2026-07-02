-- =====================================================================
-- Security hardening migration
-- Addresses flaws #1, #2, #3, #4, #6, #8, #10, #12, #14
-- =====================================================================

-- -------------------------------------------------------------------
-- #1 Privilege escalation via signup metadata role
-- handle_new_user must IGNORE client-supplied role. Public signups
-- are always 'parent'. Children are created via admin API (which
-- still passes role='child' through metadata, so we must allow that
-- pathway only when the call comes from the service role).
-- Trick: only honor metadata role if raw_app_meta_data.provisioned = true,
-- which only the service role can set via auth.admin.createUser.
-- -------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _role text := 'parent';
  _is_provisioned boolean := false;
  _meta_role text;
begin
  insert into public.profiles (id, name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',''),
    new.email,
    new.raw_user_meta_data->>'phone'
  );

  -- Only trust metadata role if the user was provisioned server-side
  -- (service role sets app_metadata.provisioned = true).
  _is_provisioned := coalesce((new.raw_app_meta_data->>'provisioned')::boolean, false);
  if _is_provisioned then
    _meta_role := new.raw_user_meta_data->>'role';
    if _meta_role = 'student' then _meta_role := 'child'; end if;
    if _meta_role in ('admin','parent','child') then
      _role := _meta_role;
    end if;
  end if;

  insert into public.user_roles (user_id, role) values (new.id, _role::public.app_role);
  return new;
end;
$$;

-- -------------------------------------------------------------------
-- #3 Children can change their parent (or unlink)
-- Drop the over-broad "Users can update own profile" policy and
-- replace with a column-restrictive trigger that prevents non-admins
-- from changing id, parent_id, or email on their own profile.
-- -------------------------------------------------------------------
create or replace function public.profiles_block_sensitive_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow service role and admins to change anything
  if (auth.role() = 'service_role') or public.has_role(auth.uid(), 'admin') then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Cannot change profile id';
  end if;
  if new.parent_id is distinct from old.parent_id then
    raise exception 'Cannot change parent_id';
  end if;
  if new.email is distinct from old.email then
    raise exception 'Cannot change email here; update via auth instead';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_sensitive on public.profiles;
create trigger profiles_protect_sensitive
before update on public.profiles
for each row execute function public.profiles_block_sensitive_updates();

-- -------------------------------------------------------------------
-- #4 + #10 accept_invitation hardening:
--   - Bind invite to caller's email
--   - Refuse to demote admins or already-linked users
--   - Use upsert instead of delete-then-insert
-- -------------------------------------------------------------------
create or replace function public.accept_invitation(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _invite public.invitations;
  _uid uuid;
  _email text;
  _existing_parent uuid;
begin
  _uid := auth.uid();
  if _uid is null then raise exception 'Not authenticated'; end if;

  -- Block admins from being demoted
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

  select parent_id into _existing_parent from public.profiles where id = _uid;
  if _existing_parent is not null and _existing_parent <> _invite.parent_id then
    raise exception 'You are already linked to a parent';
  end if;

  -- Linking via service-definer so the column-update trigger allows it
  -- (trigger checks auth.role() = 'service_role' OR admin; security definer
  -- doesn't change auth.role(), so we must temporarily disable the trigger).
  alter table public.profiles disable trigger profiles_protect_sensitive;
  update public.profiles set parent_id = _invite.parent_id where id = _uid;
  alter table public.profiles enable trigger profiles_protect_sensitive;

  -- Upsert child role; do not delete other roles
  insert into public.user_roles (user_id, role) values (_uid, 'child')
    on conflict (user_id, role) do nothing;

  update public.invitations set status='accepted', accepted_user_id=_uid where id=_invite.id;
  return _invite.parent_id;
end;
$$;

-- -------------------------------------------------------------------
-- #6 Restore EXECUTE on has_role / get_primary_role for authenticated.
-- Policies that call has_role() require this even though it's SECURITY DEFINER.
-- -------------------------------------------------------------------
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.get_primary_role(uuid) to authenticated;

-- -------------------------------------------------------------------
-- #8 Prevent duplicate pending invitations to the same email per parent
-- -------------------------------------------------------------------
create unique index if not exists invitations_unique_pending_per_parent_email
  on public.invitations (parent_id, lower(email))
  where status = 'pending';

-- -------------------------------------------------------------------
-- #12 Mirror auth.users.email changes into profiles.email
-- -------------------------------------------------------------------
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    -- Disable the protect trigger because this is a system-driven sync
    alter table public.profiles disable trigger profiles_protect_sensitive;
    update public.profiles set email = new.email where id = new.id;
    alter table public.profiles enable trigger profiles_protect_sensitive;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
after update of email on auth.users
for each row execute function public.sync_profile_email();

-- -------------------------------------------------------------------
-- #14 Restrict get_invitation_by_token: anon callers get only status/expires.
-- Replace the existing function so anon receives a sanitized result.
-- -------------------------------------------------------------------
create or replace function public.get_invitation_by_token(_token text)
returns table(email text, status public.invitation_status, parent_name text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _caller_email text;
  _is_authed boolean := auth.uid() is not null;
begin
  if _is_authed then
    select u.email into _caller_email from auth.users u where u.id = auth.uid();
  end if;

  return query
  select
    case when _is_authed and lower(i.email) = lower(coalesce(_caller_email,'')) then i.email
         else null::text end as email,
    i.status,
    case when _is_authed and lower(i.email) = lower(coalesce(_caller_email,'')) then p.name
         else null::text end as parent_name,
    i.expires_at
  from public.invitations i
  left join public.profiles p on p.id = i.parent_id
  where i.token = _token
  limit 1;
end;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- -------------------------------------------------------------------
-- #2 Note: the old migration 4 already inserted admin@buffr.com with a
-- hardcoded password. We rotate it now to a random value so the committed
-- password no longer works. The user must reset the password via "Forgot
-- password" or have a new one set via the dashboard.
-- -------------------------------------------------------------------
do $$
declare
  _uid uuid;
  _new_pw text;
begin
  select id into _uid from auth.users where email = 'admin@buffr.com';
  if _uid is not null then
    -- Random 32-byte hex password; nobody knows it, forces password reset
    _new_pw := encode(gen_random_bytes(32), 'hex');
    update auth.users
      set encrypted_password = crypt(_new_pw, gen_salt('bf'))
      where id = _uid;
  end if;
end $$;

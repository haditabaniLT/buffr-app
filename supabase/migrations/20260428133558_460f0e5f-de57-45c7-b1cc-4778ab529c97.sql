-- Rename 'student' role to 'child' across the app

-- 1) Create new enum with desired values
create type public.app_role_new as enum ('admin', 'parent', 'child');

-- 2) Drop policies/functions that depend on old enum, recreate after
-- Drop functions that reference app_role
drop function if exists public.has_role(uuid, public.app_role) cascade;
drop function if exists public.get_primary_role(uuid) cascade;

-- 3) Convert column on user_roles
alter table public.user_roles
  alter column role type public.app_role_new
  using (case role::text when 'student' then 'child' else role::text end)::public.app_role_new;

-- 4) Replace enum
drop type public.app_role;
alter type public.app_role_new rename to app_role;

-- 5) Recreate functions
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.get_primary_role(_user_id uuid)
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.user_roles where user_id = _user_id
  order by case role when 'admin' then 1 when 'parent' then 2 when 'child' then 3 end
  limit 1
$$;

-- 6) Recreate policies that used has_role(...)
create policy "Admins can view all profiles" on public.profiles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "Parents can create invitations" on public.invitations
  for insert to authenticated
  with check ((parent_id = auth.uid()) and public.has_role(auth.uid(), 'parent'));

create policy "Admins can manage roles" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can view all roles" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- 7) Update handle_new_user and accept_invitation to use 'child'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  _role text;
begin
  insert into public.profiles (id, name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'name',''), new.email, new.raw_user_meta_data->>'phone');

  _role := coalesce(new.raw_user_meta_data->>'role', 'parent');
  if _role = 'student' then _role := 'child'; end if;
  if _role not in ('admin','parent','child') then _role := 'parent'; end if;

  insert into public.user_roles (user_id, role) values (new.id, _role::public.app_role);
  return new;
end;
$$;

create or replace function public.accept_invitation(_token text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _invite public.invitations; _uid uuid;
begin
  _uid := auth.uid();
  if _uid is null then raise exception 'Not authenticated'; end if;
  select * into _invite from public.invitations
    where token = _token and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'Invalid or expired invitation'; end if;

  update public.profiles set parent_id = _invite.parent_id where id = _uid;
  delete from public.user_roles where user_id = _uid;
  insert into public.user_roles (user_id, role) values (_uid, 'child');

  update public.invitations set status='accepted', accepted_user_id=_uid where id=_invite.id;
  return _invite.parent_id;
end;
$$;

-- 8) Ensure handle_new_user trigger exists
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 9) Create admin user with verified email
do $$
declare
  _uid uuid;
begin
  select id into _uid from auth.users where email = 'admin@buffr.com';
  if _uid is null then
    _uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated',
      'admin@buffr.com', crypt('@@Power2me!!@@##', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Admin","role":"admin"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  else
    update auth.users
      set encrypted_password = crypt('@@Power2me!!@@##', gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now())
      where id = _uid;
  end if;

  insert into public.profiles (id, name, email)
  values (_uid, 'Admin', 'admin@buffr.com')
  on conflict (id) do nothing;

  delete from public.user_roles where user_id = _uid;
  insert into public.user_roles (user_id, role) values (_uid, 'admin');
end $$;

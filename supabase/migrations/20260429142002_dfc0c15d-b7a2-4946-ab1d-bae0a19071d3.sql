-- ============================================================
-- 1. WIPE: drop existing schema objects + all auth users
-- ============================================================

-- Drop existing triggers on auth.users (created by previous migrations)
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_email_change on auth.users;

-- Drop existing tables (cascades dependent policies/triggers/functions tied to them)
drop table if exists public.invitations cascade;
drop table if exists public.user_roles cascade;
drop table if exists public.profiles cascade;
drop table if exists public.users cascade;
drop table if exists public.roles cascade;

-- Drop existing functions
drop function if exists public.handle_new_user() cascade;
drop function if exists public.has_role(uuid, public.app_role) cascade;
drop function if exists public.get_primary_role(uuid) cascade;
drop function if exists public.accept_invitation(text) cascade;
drop function if exists public.get_invitation_by_token(text) cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.profiles_block_sensitive_updates() cascade;
drop function if exists public.users_block_sensitive_updates() cascade;
drop function if exists public.sync_profile_email() cascade;
drop function if exists public.sync_user_email() cascade;

-- Drop enums
drop type if exists public.app_role cascade;
drop type if exists public.invitation_status cascade;

-- Wipe all auth users (clean slate as requested)
delete from auth.users;

-- ============================================================
-- 2. ENUMS
-- ============================================================

create type public.app_role as enum ('admin', 'parent', 'child');
create type public.invitation_status as enum ('pending', 'accepted', 'expired');

-- ============================================================
-- 3. ROLES LOOKUP TABLE (seeded)
-- ============================================================

create table public.roles (
  id smallserial primary key,
  name text not null unique
);

insert into public.roles (name) values ('Admin'), ('Parent'), ('Child');

alter table public.roles enable row level security;

create policy "Roles readable by anyone authenticated"
  on public.roles for select to authenticated using (true);

-- ============================================================
-- 4. USERS TABLE (replaces profiles, only necessary fields)
-- ============================================================

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  phone text,
  avatar_url text,
  parent_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index users_parent_id_idx on public.users(parent_id);

alter table public.users enable row level security;

-- ============================================================
-- 5. USER_ROLES TABLE
-- ============================================================

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

-- ============================================================
-- 6. INVITATIONS TABLE
-- ============================================================

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  parent_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  status public.invitation_status not null default 'pending',
  accepted_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create unique index invitations_one_pending_per_email_per_parent
  on public.invitations(parent_id, lower(email))
  where status = 'pending';

alter table public.invitations enable row level security;

-- ============================================================
-- 7. SECURITY-DEFINER ROLE HELPERS
-- ============================================================

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

grant execute on function public.has_role(uuid, public.app_role) to authenticated;

create or replace function public.get_primary_role(_user_id uuid)
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.user_roles where user_id = _user_id
  order by case role when 'admin' then 1 when 'parent' then 2 when 'child' then 3 end
  limit 1
$$;

grant execute on function public.get_primary_role(uuid) to authenticated;

-- ============================================================
-- 8. RLS POLICIES
-- ============================================================

-- USERS
create policy "Users can view own record"
  on public.users for select to authenticated
  using (auth.uid() = id);

create policy "Parents can view their children"
  on public.users for select to authenticated
  using (parent_id = auth.uid());

create policy "Admins can view all users"
  on public.users for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Users can update own record"
  on public.users for update to authenticated
  using (auth.uid() = id);

create policy "Admins can update any user"
  on public.users for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- USER_ROLES
create policy "Users can view own roles"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

create policy "Admins can view all roles"
  on public.user_roles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can manage roles"
  on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- INVITATIONS
create policy "Parents view own invitations"
  on public.invitations for select to authenticated
  using (parent_id = auth.uid());

create policy "Parents create invitations"
  on public.invitations for insert to authenticated
  with check (parent_id = auth.uid() and public.has_role(auth.uid(), 'parent'));

create policy "Parents delete own invitations"
  on public.invitations for delete to authenticated
  using (parent_id = auth.uid());

-- ============================================================
-- 9. PROTECT SENSITIVE COLUMNS ON USERS
-- ============================================================

create or replace function public.users_block_sensitive_updates()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (auth.role() = 'service_role') or public.has_role(auth.uid(), 'admin') then
    return new;
  end if;
  if new.id is distinct from old.id then
    raise exception 'Cannot change user id';
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

create trigger users_protect_sensitive
  before update on public.users
  for each row execute function public.users_block_sensitive_updates();

-- ============================================================
-- 10. AUTH HOOKS
-- ============================================================

-- New user: create users row + assign role.
-- Always 'parent' for self-signups. Admin/child must be server-provisioned
-- (signaled by app_metadata.provisioned = true).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  _role public.app_role := 'parent';
  _is_provisioned boolean := coalesce((new.raw_app_meta_data->>'provisioned')::boolean, false);
  _meta_role text;
begin
  insert into public.users (id, name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',''),
    new.email,
    new.raw_user_meta_data->>'phone'
  );

  if _is_provisioned then
    _meta_role := new.raw_user_meta_data->>'role';
    if _meta_role in ('admin','parent','child') then
      _role := _meta_role::public.app_role;
    end if;
  end if;

  insert into public.user_roles (user_id, role) values (new.id, _role);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sync email changes from auth.users into public.users
create or replace function public.sync_user_email()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    alter table public.users disable trigger users_protect_sensitive;
    update public.users set email = new.email where id = new.id;
    alter table public.users enable trigger users_protect_sensitive;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row execute function public.sync_user_email();

-- ============================================================
-- 11. INVITATION FUNCTIONS
-- ============================================================

create or replace function public.get_invitation_by_token(_token text)
returns table (
  email text,
  status public.invitation_status,
  parent_name text,
  expires_at timestamptz
)
language plpgsql stable security definer set search_path = public
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
  left join public.users p on p.id = i.parent_id
  where i.token = _token
  limit 1;
end;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

create or replace function public.accept_invitation(_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
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

  insert into public.user_roles (user_id, role) values (_uid, 'child')
    on conflict (user_id, role) do nothing;

  update public.invitations
    set status='accepted', accepted_user_id=_uid
    where id = _invite.id;
  return _invite.parent_id;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;

-- ============================================================
-- 12. SEED ADMIN USER (admin@buffr.com)
-- ============================================================
-- Inserts directly into auth.users with bcrypt-hashed password.
-- The handle_new_user trigger will create users + user_roles rows.
-- app_metadata.provisioned=true so the trigger honors role='admin'.
-- app_metadata.must_change_password=true flags the UI to force a reset.
do $$
declare
  _admin_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    _admin_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin@buffr.com',
    crypt('@@Power2me!!@@##', gen_salt('bf')),
    now(),
    jsonb_build_object('provider','email','providers',array['email'],'provisioned',true,'must_change_password',true),
    jsonb_build_object('name','Buffr Admin','role','admin'),
    now(), now(), '', '', '', ''
  );
end$$;

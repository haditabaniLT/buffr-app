-- Enums
create type public.app_role as enum ('admin', 'parent', 'student');
create type public.invitation_status as enum ('pending', 'accepted', 'expired');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  phone text,
  avatar_url text,
  parent_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- Invitations
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  status public.invitation_status not null default 'pending',
  accepted_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index invitations_token_idx on public.invitations(token);
create index invitations_parent_idx on public.invitations(parent_id);

-- has_role security definer
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- get_user_role helper
create or replace function public.get_primary_role(_user_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = _user_id
  order by case role when 'admin' then 1 when 'parent' then 2 when 'student' then 3 end
  limit 1
$$;

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- handle_new_user: create profile + assign parent role on signup (default for public signup)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _role text;
begin
  insert into public.profiles (id, name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    new.raw_user_meta_data->>'phone'
  );

  -- Allow signup metadata to override the default (e.g. invite flow sets 'student')
  _role := coalesce(new.raw_user_meta_data->>'role', 'parent');

  if _role not in ('admin', 'parent', 'student') then
    _role := 'parent';
  end if;

  insert into public.user_roles (user_id, role) values (new.id, _role::public.app_role);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- accept_invitation: called after an invited student signs up; links them to the parent
create or replace function public.accept_invitation(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _invite public.invitations;
  _uid uuid;
begin
  _uid := auth.uid();
  if _uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into _invite from public.invitations
  where token = _token and status = 'pending' and expires_at > now()
  for update;

  if not found then
    raise exception 'Invalid or expired invitation';
  end if;

  -- Link student to parent
  update public.profiles set parent_id = _invite.parent_id where id = _uid;

  -- Switch role from parent (default) to student
  delete from public.user_roles where user_id = _uid;
  insert into public.user_roles (user_id, role) values (_uid, 'student');

  -- Mark invitation accepted
  update public.invitations
  set status = 'accepted', accepted_user_id = _uid
  where id = _invite.id;

  return _invite.parent_id;
end;
$$;

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.invitations enable row level security;

-- Profiles policies
create policy "Users can view own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

create policy "Parents can view their students"
on public.profiles for select to authenticated
using (parent_id = auth.uid());

create policy "Admins can view all profiles"
on public.profiles for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy "Users can update own profile"
on public.profiles for update to authenticated
using (auth.uid() = id);

-- User roles policies
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

-- Invitations policies
create policy "Parents can view own invitations"
on public.invitations for select to authenticated
using (parent_id = auth.uid());

create policy "Parents can create invitations"
on public.invitations for insert to authenticated
with check (parent_id = auth.uid() and public.has_role(auth.uid(), 'parent'));

create policy "Parents can delete own invitations"
on public.invitations for delete to authenticated
using (parent_id = auth.uid());
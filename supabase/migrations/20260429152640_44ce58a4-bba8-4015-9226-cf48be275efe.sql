
-- 1) user_status enum + column
do $$ begin
  create type public.user_status as enum ('active','suspended','blocked');
exception when duplicate_object then null; end $$;

alter table public.users
  add column if not exists status public.user_status not null default 'active';

-- 2) flag_category enum + merchants table
do $$ begin
  create type public.flag_category as enum ('gambling','payday_loan','crypto','high_risk');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.risk_level as enum ('low','medium','high');
exception when duplicate_object then null; end $$;

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category public.flag_category not null,
  risk_level public.risk_level not null default 'high',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_merchants_name_lower on public.merchants (lower(name));

alter table public.merchants enable row level security;

drop policy if exists "Authenticated can view merchants" on public.merchants;
create policy "Authenticated can view merchants" on public.merchants
  for select to authenticated using (true);

drop policy if exists "Admins manage merchants" on public.merchants;
create policy "Admins manage merchants" on public.merchants
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists merchants_set_updated_at on public.merchants;
create trigger merchants_set_updated_at before update on public.merchants
  for each row execute function public.set_updated_at();

-- 3) Admin RPC: list all non-admin users with parent name
create or replace function public.admin_list_users()
returns table(
  id uuid,
  name text,
  email text,
  phone text,
  status public.user_status,
  role public.app_role,
  parent_id uuid,
  parent_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.name, u.email, u.phone, u.status,
         public.get_primary_role(u.id) as role,
         u.parent_id,
         p.name as parent_name,
         u.created_at
  from public.users u
  left join public.users p on p.id = u.parent_id
  where public.has_role(auth.uid(), 'admin')
    and not public.has_role(u.id, 'admin')
  order by u.created_at desc
$$;

-- 4) Seed merchants from existing demo list (no-op if already populated)
insert into public.merchants (name, category, risk_level)
select v.name, v.category::public.flag_category, v.risk_level::public.risk_level
from (values
  ('DraftKings','gambling','high'),
  ('FanDuel','gambling','high'),
  ('Coinbase','crypto','medium'),
  ('Binance','crypto','high'),
  ('MoneyMutual','payday_loan','high'),
  ('CashNetUSA','payday_loan','high'),
  ('BetMGM','gambling','high')
) as v(name, category, risk_level)
where not exists (select 1 from public.merchants m where lower(m.name) = lower(v.name));

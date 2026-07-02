-- Bank accounts connected via Plaid
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,            -- whose account this currently is (parent or child)
  linked_by_parent_id uuid not null,      -- the parent who connected it via Plaid
  plaid_item_id text not null,
  plaid_account_id text not null,
  plaid_access_token text not null,       -- secret; protected by RLS (no anon/auth select of this column directly is fine via RLS row-level)
  institution_name text,
  account_name text,
  account_mask text,
  account_type text,
  account_subtype text,
  current_balance numeric(14,2),
  available_balance numeric(14,2),
  iso_currency_code text default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plaid_item_id, plaid_account_id)
);

create index bank_accounts_owner_idx on public.bank_accounts(owner_user_id);
create index bank_accounts_parent_idx on public.bank_accounts(linked_by_parent_id);

alter table public.bank_accounts enable row level security;

-- Parents: see + manage their own + their children's accounts
create policy "Parents view own and children accounts"
  on public.bank_accounts for select
  to authenticated
  using (
    linked_by_parent_id = auth.uid()
    or owner_user_id = auth.uid()
    or exists (select 1 from public.users u where u.id = bank_accounts.owner_user_id and u.parent_id = auth.uid())
  );

create policy "Parents insert accounts they linked"
  on public.bank_accounts for insert
  to authenticated
  with check (
    linked_by_parent_id = auth.uid()
    and public.has_role(auth.uid(), 'parent')
  );

create policy "Parents update own/children accounts"
  on public.bank_accounts for update
  to authenticated
  using (linked_by_parent_id = auth.uid())
  with check (linked_by_parent_id = auth.uid());

create policy "Parents delete own/children accounts"
  on public.bank_accounts for delete
  to authenticated
  using (linked_by_parent_id = auth.uid());

create policy "Admins view all accounts"
  on public.bank_accounts for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
create trigger bank_accounts_set_updated_at
  before update on public.bank_accounts
  for each row execute function public.set_updated_at();

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
  where not public.has_role(u.id, 'admin')
  order by u.created_at desc
$$;

revoke execute on function public.admin_list_users() from anon, authenticated;

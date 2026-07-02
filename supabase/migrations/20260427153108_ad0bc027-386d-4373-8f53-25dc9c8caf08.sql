create or replace function public.get_invitation_by_token(_token text)
returns table (
  email text,
  status public.invitation_status,
  parent_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.email, i.status, p.name as parent_name, i.expires_at
  from public.invitations i
  left join public.profiles p on p.id = i.parent_id
  where i.token = _token
  limit 1
$$;

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
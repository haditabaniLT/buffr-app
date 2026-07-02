-- Allow anon callers holding a valid invitation token to read the invited email
-- (token itself is the secret; needed so the invite acceptance page can prefill email)
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token text)
 RETURNS TABLE(email text, status invitation_status, parent_name text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  select
    i.email,
    i.status,
    p.name as parent_name,
    i.expires_at
  from public.invitations i
  left join public.users p on p.id = i.parent_id
  where i.token = _token
  limit 1;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;
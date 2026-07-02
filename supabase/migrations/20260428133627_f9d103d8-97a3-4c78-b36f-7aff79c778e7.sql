revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.get_primary_role(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- Keep accept_invitation and get_invitation_by_token callable by signed-in users (RPC)
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
-- Keep account-control columns off the client Data API.
-- users.status, users.is_minor, and users.date_of_birth were still writable
-- by the row owner. bank_accounts.plaid_access_token was readable by anyone
-- the row-level policies allowed, and owner_user_id was not constrained on write.

CREATE OR REPLACE FUNCTION public.users_block_sensitive_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (auth.role() = 'service_role') OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot change user id';
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'Cannot change parent_id';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Cannot change email here; update via auth instead';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Cannot change role; contact support';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change account status';
  END IF;
  IF NEW.is_minor IS DISTINCT FROM OLD.is_minor THEN
    RAISE EXCEPTION 'Cannot change minor status';
  END IF;
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    RAISE EXCEPTION 'Cannot change date of birth';
  END IF;
  RETURN NEW;
END;
$$;

-- Column privileges, not RLS, decide which fields the Data API can return.
-- Table-level SELECT still covers every column, so revoke it and grant the
-- display columns only. service_role keeps the grants it already has.
REVOKE ALL ON TABLE public.bank_accounts FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  owner_user_id,
  linked_by_parent_id,
  institution_name,
  account_name,
  account_mask,
  account_type,
  account_subtype,
  available_balance,
  current_balance,
  iso_currency_code,
  created_at,
  updated_at
) ON TABLE public.bank_accounts TO authenticated;

DROP POLICY IF EXISTS "Parents insert accounts they linked" ON public.bank_accounts;
CREATE POLICY "Parents insert accounts they linked"
  ON public.bank_accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    linked_by_parent_id = auth.uid()
    AND public.has_role(auth.uid(), 'parent')
    AND (
      owner_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = owner_user_id AND u.parent_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Parents update own/children accounts" ON public.bank_accounts;
CREATE POLICY "Parents update own/children accounts"
  ON public.bank_accounts FOR UPDATE
  TO authenticated
  USING (linked_by_parent_id = auth.uid())
  WITH CHECK (
    linked_by_parent_id = auth.uid()
    AND (
      owner_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = owner_user_id AND u.parent_id = auth.uid()
      )
    )
  );

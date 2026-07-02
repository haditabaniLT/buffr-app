-- Allow adult children to link their own bank accounts.
-- linked_by_parent_id is NULL when the account owner linked it themselves.
ALTER TABLE public.bank_accounts
  ALTER COLUMN linked_by_parent_id DROP NOT NULL;

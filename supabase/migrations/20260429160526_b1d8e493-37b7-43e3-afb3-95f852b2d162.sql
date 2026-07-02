-- Raw webhook capture table
CREATE TABLE public.demotest (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payload text NOT NULL,
  plaid_item_id text,
  bank_account_id uuid,
  owner_user_id uuid,
  owner_name text,
  owner_email text,
  linked_by_parent_id uuid,
  linked_by_parent_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.demotest ENABLE ROW LEVEL SECURITY;

-- Only admins can read; inserts are done server-side with the service role (bypasses RLS).
CREATE POLICY "Admins can view demotest"
ON public.demotest
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_demotest_plaid_item_id ON public.demotest(plaid_item_id);
CREATE INDEX idx_demotest_created_at ON public.demotest(created_at DESC);
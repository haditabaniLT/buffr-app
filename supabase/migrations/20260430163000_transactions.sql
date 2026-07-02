-- ============================================================
-- 1. Add transactions_sync_cursor to bank_accounts
--    Used by /transactions/sync to resume incremental updates.
-- ============================================================

ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS transactions_sync_cursor text;

-- ============================================================
-- 2. Transactions table
--    Stores Plaid-synced transactions per account.
--    id = Plaid transaction_id (stable across modifications).
--    Idempotent: safe to re-run if partially applied.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id                        text        PRIMARY KEY,   -- Plaid transaction_id
  account_id                text        NOT NULL,      -- Plaid account_id
  bank_account_id           uuid        REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  owner_user_id             uuid        REFERENCES public.users(id)         ON DELETE SET NULL,
  amount                    numeric(14, 2) NOT NULL,   -- positive = debit, negative = credit
  iso_currency_code         text        NOT NULL DEFAULT 'USD',
  name                      text,                      -- Plaid merchant/description string
  merchant_name             text,                      -- cleaned merchant name
  category                  text[]      NOT NULL DEFAULT '{}',
  personal_finance_category text,                      -- Plaid PFC primary category
  date                      date        NOT NULL,
  pending                   boolean     NOT NULL DEFAULT false,
  plaid_item_id             text        NOT NULL,
  raw_json                  jsonb,                     -- full Plaid transaction object
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_bank_account_id  ON public.transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_owner_user_id    ON public.transactions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date             ON public.transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_plaid_item_id    ON public.transactions(plaid_item_id);
CREATE INDEX IF NOT EXISTS idx_transactions_pending          ON public.transactions(pending) WHERE pending = true;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Policies: drop-and-recreate so the migration is idempotent
DROP POLICY IF EXISTS "Users view own transactions"       ON public.transactions;
DROP POLICY IF EXISTS "Parents view children transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins view all transactions"      ON public.transactions;

-- Parents: see own transactions + children's transactions
CREATE POLICY "Users view own transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY "Parents view children transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = transactions.owner_user_id
        AND u.parent_id = auth.uid()
    )
  );

CREATE POLICY "Admins view all transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No INSERT/UPDATE/DELETE from the client — writes are service-role only (edge function)

-- updated_at trigger
DROP TRIGGER IF EXISTS transactions_set_updated_at ON public.transactions;
CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

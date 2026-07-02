-- ============================================================
-- 1. Flagging columns on transactions
--    Idempotent: ADD COLUMN IF NOT EXISTS throughout.
-- ============================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_flagged      boolean          NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason     text,
  ADD COLUMN IF NOT EXISTS flag_category   public.flag_category;

CREATE INDEX IF NOT EXISTS idx_transactions_is_flagged
  ON public.transactions(is_flagged) WHERE is_flagged = true;

-- ============================================================
-- 2. SMS logs — one row per Twilio message dispatched
--    Idempotent: CREATE TABLE IF NOT EXISTS + DROP/CREATE policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sms_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  transaction_id text        REFERENCES public.transactions(id)   ON DELETE SET NULL,
  phone          text        NOT NULL,
  message        text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
  twilio_sid     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_parent_id       ON public.sms_logs(parent_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_transaction_id  ON public.sms_logs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at      ON public.sms_logs(created_at DESC);

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents view own SMS logs"  ON public.sms_logs;
DROP POLICY IF EXISTS "Admins view all SMS logs"   ON public.sms_logs;

CREATE POLICY "Parents view own SMS logs"
  ON public.sms_logs FOR SELECT TO authenticated
  USING (parent_id = auth.uid());

CREATE POLICY "Admins view all SMS logs"
  ON public.sms_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- One row per attempt to notify a parent about a flagged transaction.
-- type is the channel. sms is the only value for now; add others to the enum later.
-- status is the outcome of that attempt.
-- attempted_at is timestamptz and is always set, including failures.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE public.notification_type AS ENUM ('sms');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
    CREATE TYPE public.notification_status AS ENUM ('sent', 'failed', 'skipped', 'opted_out');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notification_attempts (
  id              uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  text                       NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  type            public.notification_type   NOT NULL,
  status          public.notification_status NOT NULL,
  attempted_at    timestamptz                NOT NULL,
  error           text,
  created_at      timestamptz                NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_transaction
  ON public.notification_attempts (transaction_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_failed
  ON public.notification_attempts (transaction_id)
  WHERE status = 'failed';

COMMENT ON TABLE public.notification_attempts IS
  'Each try to notify someone about a flagged transaction. A sent row means that channel succeeded.';
COMMENT ON COLUMN public.notification_attempts.attempted_at IS
  'When the attempt was made. Always set, whether or not the send succeeded.';
COMMENT ON COLUMN public.notification_attempts.error IS
  'Short reason the attempt did not send. Null when status is sent.';

ALTER TABLE public.notification_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents view own notification attempts" ON public.notification_attempts;
DROP POLICY IF EXISTS "Admins view all notification attempts" ON public.notification_attempts;

CREATE POLICY "Parents view own notification attempts"
  ON public.notification_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.transactions t
      JOIN public.users u ON u.id = t.owner_user_id
      WHERE t.id = notification_attempts.transaction_id
        AND (u.id = auth.uid() OR u.parent_id = auth.uid())
    )
  );

CREATE POLICY "Admins view all notification attempts"
  ON public.notification_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

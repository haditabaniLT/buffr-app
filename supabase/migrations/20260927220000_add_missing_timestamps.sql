-- Mutable rows get created_at and updated_at.
-- Insert-only logs stay created_at only: sms_logs, plaid_webhook_events.
-- bank_accounts, transactions, merchants, and faqs already have both.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.users
  SET updated_at = created_at
  WHERE updated_at IS NULL;

ALTER TABLE public.users
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.invitations
  SET updated_at = created_at
  WHERE updated_at IS NULL;

ALTER TABLE public.invitations
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS invitations_set_updated_at ON public.invitations;
CREATE TRIGGER invitations_set_updated_at
  BEFORE UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.notifications
  SET updated_at = created_at
  WHERE updated_at IS NULL;

ALTER TABLE public.notifications
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS notifications_set_updated_at ON public.notifications;
CREATE TRIGGER notifications_set_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.content_pages
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE public.content_pages
  SET created_at = updated_at
  WHERE created_at IS NULL;

ALTER TABLE public.content_pages
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

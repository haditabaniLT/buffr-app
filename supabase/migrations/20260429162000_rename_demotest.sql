-- Rename demotest → plaid_webhook_events with proper naming for indexes/policies

ALTER TABLE public.demotest RENAME TO plaid_webhook_events;

-- Rename indexes to match new table name
ALTER INDEX IF EXISTS idx_demotest_plaid_item_id RENAME TO idx_plaid_webhook_events_item_id;
ALTER INDEX IF EXISTS idx_demotest_created_at    RENAME TO idx_plaid_webhook_events_created_at;

-- Rename policy
DROP POLICY IF EXISTS "Admins can view demotest" ON public.plaid_webhook_events;
CREATE POLICY "Admins can view plaid_webhook_events"
  ON public.plaid_webhook_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

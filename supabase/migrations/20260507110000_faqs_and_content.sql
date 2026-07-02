-- FAQs table
CREATE TABLE IF NOT EXISTS public.faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read faqs"
  ON public.faqs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage faqs"
  ON public.faqs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Content pages (terms, privacy, etc.)
CREATE TABLE IF NOT EXISTS public.content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.content_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read content"
  ON public.content_pages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage content"
  ON public.content_pages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default content pages
INSERT INTO public.content_pages (slug, title, body) VALUES
  ('terms', 'Terms of Service', 'By using Buffr, you agree to these terms. Buffr is a financial monitoring platform designed to help parents monitor their children''s spending activity. You agree to use this service only for lawful purposes and in compliance with all applicable laws and regulations.'),
  ('privacy', 'Privacy Policy', 'Buffr respects your privacy. We collect only the data necessary to provide our financial monitoring service, including transaction data from linked bank accounts via Plaid. Your data is encrypted and never sold to third parties.')
ON CONFLICT (slug) DO NOTHING;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER faqs_set_updated_at
  BEFORE UPDATE ON public.faqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER content_pages_set_updated_at
  BEFORE UPDATE ON public.content_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

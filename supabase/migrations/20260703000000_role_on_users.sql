-- Collapse user_roles + roles into a single `role` column on users.
-- Also adds date_of_birth and missing FK constraints on bank_accounts.

-- ── 1. Role enum ────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'parent', 'child');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. New columns on users ─────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role          public.app_role,
  ADD COLUMN IF NOT EXISTS date_of_birth date;

-- ── 3. Migrate data from user_roles + roles (skip if tables already dropped) ─
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_roles')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'roles')
  THEN
    UPDATE public.users u
    SET role = r.name::public.app_role
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id;
  END IF;
END $$;

-- Any user without a role defaults to parent (admin should already be set manually)
UPDATE public.users SET role = 'parent' WHERE role IS NULL;

-- ── 4. Enforce NOT NULL + default ───────────────────────────────────────────
ALTER TABLE public.users
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN role SET DEFAULT 'parent'::public.app_role;

-- ── 5. FK constraints missing from bank_accounts ────────────────────────────
ALTER TABLE public.bank_accounts
  ADD CONSTRAINT bank_accounts_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.bank_accounts
  ADD CONSTRAINT bank_accounts_linked_by_parent_id_fkey
    FOREIGN KEY (linked_by_parent_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 6. get_primary_role now reads from users.role (no join needed) ───────────
DROP FUNCTION IF EXISTS public.get_primary_role(uuid);
CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.users WHERE id = _user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO authenticated;

-- ── 7. handle_new_user sets users.role directly ──────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role  public.app_role;
  _name  text;
  _phone text;
BEGIN
  -- Role resolution (same logic as before, no user_roles insert):
  --   1. provisioned=true + explicit role  → trust it (admin creates child/admin accounts)
  --   2. pending invitation for this email → child
  --   3. everything else                   → parent (public signup)
  IF NEW.raw_app_meta_data->>'provisioned' = 'true'
     AND (NEW.raw_app_meta_data->>'role') IS NOT NULL THEN
    _role := (NEW.raw_app_meta_data->>'role')::public.app_role;
  ELSIF EXISTS (
    SELECT 1 FROM public.invitations
    WHERE email = NEW.email AND status = 'pending'
  ) THEN
    _role := 'child';
  ELSE
    _role := 'parent';
  END IF;

  _name  := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  _phone := NEW.raw_user_meta_data->>'phone';

  INSERT INTO public.users (id, email, name, phone, role)
  VALUES (NEW.id, NEW.email, _name, _phone, _role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        name  = COALESCE(NULLIF(EXCLUDED.name, ''), public.users.name),
        phone = COALESCE(EXCLUDED.phone, public.users.phone),
        role  = EXCLUDED.role;

  RETURN NEW;
END;
$$;

-- Ensure trigger is wired up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 8. Drop old tables (IF EXISTS — may already be gone) ────────────────────
DROP TABLE IF EXISTS public.user_roles;
DROP TABLE IF EXISTS public.roles;

-- Add is_minor flag to users table.
-- Set to true when a parent creates an account for a child under 18.
-- Used by the student dashboard to hide/show the "Connect bank" button.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_minor boolean NOT NULL DEFAULT false;

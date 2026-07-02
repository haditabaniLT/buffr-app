-- Add unique constraint on merchants.name so ON CONFLICT (name) works correctly.
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_name_unique UNIQUE (name);

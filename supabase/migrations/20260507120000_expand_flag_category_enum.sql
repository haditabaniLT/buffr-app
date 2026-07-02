-- Expand flag_category enum to cover all AI-detected categories.
-- ALTER TYPE ... ADD VALUE is safe and non-destructive.
ALTER TYPE public.flag_category ADD VALUE IF NOT EXISTS 'adult_content';
ALTER TYPE public.flag_category ADD VALUE IF NOT EXISTS 'mlm';
ALTER TYPE public.flag_category ADD VALUE IF NOT EXISTS 'dark_web';
ALTER TYPE public.flag_category ADD VALUE IF NOT EXISTS 'tobacco_minor';
ALTER TYPE public.flag_category ADD VALUE IF NOT EXISTS 'gaming_lootbox';
ALTER TYPE public.flag_category ADD VALUE IF NOT EXISTS 'suspicious_marketplace';
ALTER TYPE public.flag_category ADD VALUE IF NOT EXISTS 'other_risk';

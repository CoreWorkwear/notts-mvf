-- ============================================================================
-- Migration 0032: pin search_path on the two remaining trigger functions
-- (second-healthcheck advisor nit). protect_profile_columns and
-- touch_updated_at were the only functions without `set search_path` — low
-- risk since neither is security definer, but pinning closes the class: no
-- function in the schema resolves names through a caller-controlled path.
-- ============================================================================

alter function public.protect_profile_columns() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

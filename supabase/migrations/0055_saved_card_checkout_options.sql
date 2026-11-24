begin;
-- Preserve exact idempotent request bodies for already-reserved attempts.
-- Existing rows become v1; only subsequently reserved attempts get opt-in v2.
alter table public.stripe_checkout_attempts add column checkout_options_version smallint not null default 1
 check(checkout_options_version in (1,2));
alter table public.stripe_checkout_attempts alter column checkout_options_version set default 2;
comment on column public.stripe_checkout_attempts.checkout_options_version is 'Immutable Checkout request-body version: 1 original payment; 2 optional on-session save-card checkbox and consented redisplay. Never change on an existing attempt.';
commit;

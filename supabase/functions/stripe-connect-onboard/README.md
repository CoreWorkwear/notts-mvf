# Club Stripe connection

Authenticated POST body: `{ "action": "status" }` or `{ "action": "onboard" }`.
The caller's approved, active profile supplies the club. Onboarding requires
`role=admin`; status also permits active approved players. The existing
`club_payments_release.enabled` flag gates both actions. No caller-supplied
club, account, mode, redirect, or provider fields are accepted.

Required server secrets are `STRIPE_SECRET_KEY` and `APP_BASE_URL`, alongside
the Supabase runtime's URL, anon and service-role values. A server `sk_` or
restricted `rk_` key's `test`/`live` prefix determines mode. Restricted keys
need permission to read the platform and connected accounts and create accounts
and onboarding links. GET `/v1/account` determines the platform
scope. Set APP_BASE_URL to the app origin; HTTPS is required except localhost.
Callbacks are `/manage/settings/stripe?stripe=refresh` and `?stripe=return`.
The refresh screen must invoke onboarding again after authentication; the
return screen must freshly request status. Returning never marks an account ready.

Manager responses contain `connected`, `ready`, `mode`, `charges_enabled`,
`payouts_enabled`, `requirements` (currently_due, past_due, eventually_due,
pending_verification, disabled_reason), `capabilities` (card_payments,
pay_by_bank_payments), `checked_at` and `requestId`. Onboarding also returns
`onboarding_url`, a single-use link which must never be stored or logged.
Player status contains only `connected`, `ready`, `mode` and `requestId`.
`ready` requires both provider charges and payouts enabled. Individual payment
methods additionally require their own provider eligibility and method status.

Migration 0051 stores each binding separately for club, platform and mode;
browser roles have no table access and no internal RPC execution privileges.
Fresh provider reads determine status; the saved status is an informational
cache for later server workflows. This endpoint does not install a webhook.

The atomic reservation persists a creation UUID before Stripe is called.
All retries use the same account parameters and Stripe idempotency key. After
23 hours, an unbound reservation is reconciled read-only by its exact provider
metadata. No account is created if recovery is uncertain. Investigate the
platform's account inventory and server state if support recovery is required;
never delete/reset the reservation just to retry, because Stripe can forget
idempotency keys after 24 hours. Existing bindings cannot be replaced by the RPC.

Account creation uses JSON POST `/v2/core/accounts` with GB identity, full
Dashboard access, a Merchant configuration requesting card payments, and
`defaults.responsibilities` fees_collector=stripe/losses_collector=stripe.
Stripe derives responsibility for requirements collection. The Merchant is
the direct-charge merchant of record with its own payout capability; a
Recipient configuration is unnecessary for this funds flow. The creation
idempotency namespace is `club-connect:v2:` plus the durable reservation UUID.
Hosted links use JSON POST `/v2/core/account_links`. Exact HTTPS origins
`accounts.stripe.com` and `connect.stripe.com` are accepted; userinfo and custom
ports are rejected. Fresh GET `/v1/accounts/{id}` reads v2 accounts through
Stripe's documented v1 interoperability, preserving provider-owned charges,
payouts and requirements semantics. No schema change is required for v2.
There are no platform fees or destination charges. No bank, identity or card
details are collected in the app.

Provider references:
- https://docs.stripe.com/connect/accounts-v2/account-creation
- https://docs.stripe.com/api/v2/core/accounts/create
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- https://docs.stripe.com/api/v2/core/account-links/create
- https://docs.stripe.com/connect/accounts-v2/migrate-integration#use-v2-accounts-in-v1-endpoints
- https://docs.stripe.com/api/idempotent_requests

Focused verification: `npx vitest run supabase/functions/_shared/stripeConnect.test.js`.

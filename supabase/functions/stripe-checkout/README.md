# Own-player hosted Checkout

Server secrets: `STRIPE_SECRET_KEY` and `APP_BASE_URL`, plus injected Supabase
URL/anon/service-role values. Keys and connected-account IDs are never returned
to the browser. The existing Stripe transport pins `2026-11-18.endive`.

Authenticated POST requests:

- `{action:'quote',kind:'balance'}` quotes current own arrears.
- `{action:'quote',kind:'top_up',amount_pence:900}` validates an explicitly
  chosen whole-pence GBP top-up, including when settled/in credit.
- `{action:'start',attempt_id:'<UUID>',kind:'balance'|'top_up',amount_pence:900}`
  reserves the confirmed quote and creates hosted Checkout. Generate one UUID
  per genuine authorisation and reuse it for double taps/retries.
- `{action:'status',attempt_id:'<UUID>'}` reads only the caller's own attempt
  for the current club/platform/provider mode, including after release pause
  or soft removal. Other request fields, including return status, have no effect.

Quotes return `ready`, `can_pay`, `kind`, `amount_pence`, `balance_pence`,
`currency:'gbp'`, `min_amount_pence:30`, `max_amount_pence:99999999`, and an
optional `reason`. Start/status return `attempt_id`, `amount_pence`, `currency`
and `status`. Start additionally returns `checkout_url` for an open session.
Errors return `error`, optional `code`, and `requestId`. Every successful
response also has `requestId`. A changed pay-balance quote returns HTTP 409
with `code:'stale_quote'` and the new `quote`; confirm again before retrying.

Quote/start require enabled club payments and an approved active player.
Fresh provider `charges_enabled` AND `payouts_enabled` must be true for the
same 0051 club/platform/mode binding. The SQL reservation rechecks own debt
under the ledger's club lock. It stores the agreed amount and identity
snapshot, including a durable `player_accounts` row for later settlement
after hard removal. At most ten new attempts per player per ten minutes are
accepted; a replay of an existing attempt bypasses that new-attempt limit.

Customers and sessions are created on the connected account with the
`Stripe-Account` header. Customer and session idempotency derive from durable
database reservations. Old uncertain reservations reconcile read-only after
23 hours; never reset them to try creating again. Session parameters use
persisted club name, amount and callbacks, so replay inputs remain stable.

Checkout uses `mode=payment`, `ui_mode=hosted_page`, one fixed GBP line item,
no application fees, no transfers and no off-session mandate. The dynamic
eligible-method filter permits cards (including eligible hosted wallets) and
Pay by Bank; Stripe decides which are enabled and eligible for that account.
The only accepted Checkout URL origin is `https://checkout.stripe.com` with
no userinfo or custom port. The fixed return/cancel URLs are built from
APP_BASE_URL: `/you?payment_attempt=<UUID>&payment_status=return|cancelled`.

Only NOT-35's verified settlement may set stored `succeeded` and credit the
ledger. Client cancellation writes nothing. A paid provider session awaiting
the verified webhook still returns `pending` here. Database states are
`creating|pending|succeeded|failed|expired`; public creating maps to pending.
Terminal stored statuses are readable without provider mutation or a new
payment. No payment receipt or balance change is performed by this endpoint.

Session and PaymentIntent metadata both contain `club_id`, `profile_id`,
`player_account_id`, `attempt_id`, `platform_account_id`, `provider_mode`.
Session `client_reference_id` is the attempt UUID. The amount, currency,
customer, mode and full metadata are verified before binding the session.
NOT-35 must additionally verify signed event connected-account scope, event
livemode and settlement result, then atomically post exactly one gross receipt
per genuine PaymentIntent. `payment_intent_id` and `receipt_entry_id` columns
are reserved for that verified reconciliation. Browser return values are
never settlement evidence.

Primary references:
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/connect/direct-charges
- https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
- https://docs.stripe.com/api/idempotent_requests

Focused checks: `npx vitest run supabase/functions/_shared/stripeCheckout.test.js`
and focused ESLint for that helper and test.

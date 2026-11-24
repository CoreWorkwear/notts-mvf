# Player saved card controls

Authenticated POST `stripe-saved-cards`:

- `{ "action": "list" }` returns `{ "cards": [{ "id": "<opaque removal token>",
  "brand": "visa", "last4": "4242" }], "requestId": "..." }`.
- `{ "action": "remove", "id": "<token from list>", "confirmed": true }`
  returns `{ "removed": true, "requestId": "..." }`.

Both require an approved active player and the club's existing payments release
flag. The server derives club/player/platform/mode and uses only an already-bound
0053 Customer on the current 0051 connected account. It never creates a Customer
or charges a payment. Card management remains possible if provider payment
readiness later changes, while release flag and caller authorisation still apply.

The `id` field is a PaymentMethod ID plus a domain-separated HMAC signature,
using the server Stripe secret and the exact club/player/platform/mode/connected
account/customer context. It contains no customer or account IDs. It proves
list-time own-card association, including for a harmless retry after detach.
Reload the list if a key rotation invalidates a previously displayed token.
Current provider Customer metadata and connected-account scope are checked on
every request. Removal also retrieves the method and checks exact own Customer
association before detaching. A valid token for an already-detached card returns
success without another mutation. Detaching another player's method is refused.

Listing fetches card methods with `allow_redisplay=always`, following Stripe's
consent flag set by the hosted save checkbox. Only the token, card brand and last
four are returned. Provider billing details, expiry, fingerprint, customer IDs
and account IDs are never returned or logged. Pagination loads all own cards.

Migration 0055 depends on 0053 and adds `checkout_options_version`. Existing
attempts retain version 1 and their exact original Stripe idempotency payload.
New attempts default to version 2. The shared Checkout helper adds
`saved_payment_method_options[payment_method_save]=enabled` and
`saved_payment_method_options[allow_redisplay_filters][0]=always` only for v2.
Players choose the optional save checkbox inside hosted Checkout. The app never
sets `setup_future_usage`, creates setup-mode Checkout, or authorises off-session
collection. Returning Checkout still uses the same connected-account Customer.

Apply migrations and deploy the Checkout helper with this endpoint together.
Only the standard Supabase runtime secrets and existing `STRIPE_SECRET_KEY`
are needed. No additional secret or browser credential is introduced.

Primary references:
- https://docs.stripe.com/payments/checkout/save-during-payment?ui=full-page
- https://docs.stripe.com/api/checkout/sessions/create?query=saved_payment_method_options
- https://docs.stripe.com/api/payment_methods/list
- https://docs.stripe.com/api/payment_methods/detach

Focused checks: `npx vitest run supabase/functions/_shared/stripeCheckout.test.js supabase/functions/_shared/stripeSavedCards.test.js`.

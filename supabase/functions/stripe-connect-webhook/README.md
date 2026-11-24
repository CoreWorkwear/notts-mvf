# Stripe Connect settlement webhook

This endpoint accepts Stripe **Connect snapshot events**. It verifies the exact raw bytes with HMAC-SHA256 and a five-minute timestamp tolerance before parsing JSON. Its service-only settlement RPC checks the connected account, configured platform/mode, immutable app attempt metadata, customer, amount, currency and provider references again.

Required deployment environment:

- `STRIPE_WEBHOOK_SECRET_CONNECT`: this Connect endpoint's signing secret.
- `STRIPE_PLATFORM_ACCOUNT_ID`: the platform account that owns the reserved attempts.
- `STRIPE_WEBHOOK_MODE`: exactly `test` or `live`; configure each mode separately.
- Standard Supabase URL and service-role environment supplied to Edge Functions.

No Stripe API key or provider API call is needed for signed snapshot settlement. The coordinator alone configures this webhook with JWT verification disabled; authenticated checkout/setup endpoints retain JWT verification. No production deployment is performed by these files.

Subscribe the connected-account endpoint to:

- `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`.
- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
- `refund.created`, `refund.updated`, `refund.failed`.

A completed but unpaid Checkout remains pending. Only a paid Checkout success or fully received succeeded PaymentIntent posts the gross credit. Independently delivered PI/Checkout events share one scoped PI receipt. Pending or failed refund snapshots post nothing; a succeeded refund debits once by its individual refund ID and links the original receipt. Out-of-order original binding/success returns a retryable non-2xx response. Unrelated payment snapshots with no app metadata and unrelated event types, including payouts, are ignored. Unknown refund PIs remain retryable to avoid losing a refund that arrived before its original payment event.

Event completion, underlying receipt/refund and attempt state commit in one database transaction. Disabling new player payments does not suppress genuine late settlement/refunds. No redirect can post money. Fee/net/balance-transaction enrichment and payout evidence remain a separate later step and must never change the gross player credit.

Evidence: the focused shared-module suite covers raw-byte verification, stale/future/forged signatures, mode/scope, routing and retry responses. `supabase/tests/stripe_settlement_test.sql` uses synthetic fixtures and rolls back; it covers accounting, replay, late/out-of-order success/refunds and injected interruption before event completion. These checks do not establish actual Stripe delivery, physical wallet/3DS flows, production deployment or fee/payout reconciliation. The coordinator owns signed HTTP runtime and provider evidence.

Primary references: [Stripe signature verification](https://docs.stripe.com/events/manage-webhook-endpoints#signature-errors), [Checkout fulfilment and delayed methods](https://docs.stripe.com/checkout/fulfillment), [refunds](https://docs.stripe.com/refunds), [event types](https://docs.stripe.com/api/events/types).

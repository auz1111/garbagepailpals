# Phase 5 Delivered

## Scope completed

- Stripe and PayPal subscription flow foundations added for web checkout and account portal actions.
- Webhook pipeline implemented with signature verification and idempotent processing.
- Entitlement service refactored to explicit grant/revoke behavior keyed by provider and subscription reference.
- Shared payment request/response schemas added for API and client alignment.
- Unit tests added for duplicate webhook event handling.

## New API routes

- `POST /api/payments/stripe/checkout-session`
- `POST /api/payments/stripe/customer-portal`
- `POST /api/payments/paypal/subscriptions`
- `POST /api/webhooks/stripe`
- `POST /api/webhooks/paypal`

## Webhook behavior

- Stripe:
  - Verifies `stripe-signature` against configured webhook secret.
  - Handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.
- PayPal:
  - Verifies webhook authenticity through PayPal's `verify-webhook-signature` API.
  - Handles `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `PAYMENT.SALE.COMPLETED`, and `BILLING.SUBSCRIPTION.PAYMENT.FAILED`.
- Both providers:
  - Use persisted event IDs to enforce idempotency and ignore duplicates.
  - Return fast HTTP 200 on processing paths to prevent repeated retries from provider timeouts.

## Configuration added

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_ENV` (`sandbox` or `live`)

## Deferred by decision

- RevenueCat support deferred for a later phase; Stripe + PayPal delivered now.

## Validation

- `pnpm install` completed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
- Workspace diagnostics are clean.

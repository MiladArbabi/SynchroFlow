# Billing Webhooks – Stripe Integration

This directory contains the Stripe webhook ingestion surface for LaSyncro.

This layer is **intentionally minimal, defensive, and intent-only**.

---

## Core Principles

### 1. Webhooks are NOT authenticated with JWT

Stripe webhooks **must not** use `authenticateToken`.

Reason:

- Stripe is not a user
- Stripe does not carry JWTs
- Trust is established via **signature verification**, not identity tokens

Security boundary:

- `stripe-signature` header
- HMAC verification using `STRIPE_WEBHOOK_SECRET`
- Raw request body is mandatory

Any attempt to add JWT auth here is **architecturally incorrect**.

---

## 2. Raw Body Handling is Mandatory

Stripe signatures are computed over the **exact raw payload bytes**.

Rules:

- The request body must be read as raw bytes
- No JSON parsing before verification
- No middleware that mutates the body

Violation of this rule will:

- Break signature verification
- Cause intermittent production failures
- Fail silently under retries

Tests enforce this behavior intentionally.

---

## 3. Webhooks Emit INTENT ONLY

The webhook layer:

- Does NOT grant entitlements directly
- Does NOT read entitlements
- Does NOT infer lifecycle state
- Does NOT contain billing logic

Its sole responsibility is to translate:
```

Stripe Event → CommercialGrant intent

```

Business logic lives downstream.

---

## 4. Idempotency is Enforced at Two Levels

### Intent-level idempotency

- Prevents duplicate calls to `CommercialGrantService.apply`
- Ensures retry safety during request handling

### Persistent idempotency

- `commercial_grant_events.external_ref` acts as the source of truth
- Guarantees safety across:
  - Process restarts
  - Deployments
  - Stripe retries (minutes or days later)

Stripe retries are **expected behavior**, not errors.

---

## 5. Failure Semantics

Webhook responses:

- `200 OK` → Event accepted or already processed
- `400 Bad Request` → Invalid signature or malformed payload
- Never throw on duplicates
- Never retry internally

Stripe controls retry behavior.

---

## 6. Test Philosophy

Tests are intentionally strict:

- Real signature verification
- Real raw payload handling
- No test-only shortcuts
- No environment bypasses

If tests fail, production would fail.

This is by design.

---

## 7. Database Guarantees

Idempotency is enforced at the database layer via a unique constraint on
`commercial_grant_events.external_ref`.

This ensures correctness even under:

- concurrent webhook delivery
- worker restarts
- redeployments

Application-level checks are considered advisory.
The database is authoritative.

---

## ⚠️ DO NOT CHANGE WITHOUT REVIEW

This pipeline is production-sealed.

Any changes here must preserve:

- Raw body integrity
- Signature verification
- Intent-only semantics
- Idempotency guarantees

If in doubt:
**do not modify this code.**
```

---
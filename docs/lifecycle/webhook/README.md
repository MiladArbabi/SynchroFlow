# Webhook Lifecycle — LaSyncro

This document describes the **authoritative lifecycle** of webhooks in LaSyncro.

It is written for:

* engineers debugging production incidents
* operators replaying failed events
* future maintainers extending the system

If behavior and documentation ever disagree, **the code wins** — but this file is the contract the code is expected to uphold.

---

## 1. Design Principles (Non-Negotiable)

The webhook system is built on the following invariants:

1. **Fail-closed**

   * Unverified or malformed webhooks are rejected early.
   * No “best effort” domain mutation.

2. **Ledger-first**

   * Every accepted webhook is recorded before any domain logic runs.
   * The ledger is the source of truth — not logs.

3. **Idempotent by construction**

   * Duplicate events are detected and short-circuited.
   * Handlers are never executed more than once per event.

4. **Transport ≠ Domain**

   * Adapters normalize provider payloads.
   * Routers dispatch by intent.
   * Handlers perform domain mutation only.

5. **Replayable**

   * Any webhook can be replayed safely via the same execution path.

---

## 2. High-Level Flow

```
Provider (Stripe / Shopify)
        ↓
Verification Middleware
        ↓
Provider Adapter → WebhookEnvelope
        ↓
WebhookRouter.dispatch()
        ↓
integration_webhook_events (ledger)
        ↓
┌───────────────┬────────────────┐
│ sync dispatch │ queued dispatch │
└───────────────┴────────────────┘
        ↓
Domain Handler
```

There are **no alternate paths**.

---

## 3. Step-by-Step Lifecycle

### 3.1 Incoming HTTP Request

Each provider exposes **one webhook endpoint**:

* Stripe: `/api/v1/billing/stripe/webhook`
* Shopify: `/api/v1/shopify/webhooks`

Responsibilities at this layer:

* Accept raw HTTP request
* Preserve raw body bytes
* Do **nothing else**

Verification is enforced via Express middleware wiring
and is not visible inside webhook handlers or adapters.

---

### 3.2 Verification Middleware

Each provider has a dedicated verifier created via `createWebhookVerifier`.

Verification rules:

* Uses **raw request body**
* Uses provider-specific HMAC rules
* Fails closed
* On success, the request is guaranteed authentic by middleware contract.
* Ledger entries assume verified requests and do not re-validate verification state.

If verification fails:

* HTTP 400 / 500
* **No ledger write**
* **No domain logic**

---

### 3.3 Provider Adapter → WebhookEnvelope

Adapters normalize provider requests into a canonical structure:

```ts
WebhookEnvelope {
  integration: string
  eventId: string
  eventType: string
  verified: true
  // receivedAt is assigned inside buildWebhookEnvelope
  // and is not set by provider adapters
  receivedAt: Date
  rawPayload: unknown
  shopId?: number
  shopDomain?: string
}
```

⚠️ Adapters may supply placeholder identifiers (e.g. missing_event_id)
if provider headers are absent.

Fail-closed behavior relies on upstream verification and ledger constraints.

Rules:

* Envelope is immutable
* No provider logic leaks past this boundary
* Only adapters know about headers / payload quirks

---

### 3.4 Router Dispatch (Authoritative Boundary)

All envelopes pass through:

```ts
WebhookRouter.dispatch(envelope)
```

This is the **single execution gate**.

#### 3.4.1 Ledger write (FIRST operation)

The router always performs recordReceived(...) as the first side effect.

Dispatch mode resolution may occur before the ledger write,
but no side effects, handler lookup, enqueueing, or branching
occur before the ledger entry is persisted.

If the event is a duplicate:

* Status → `duplicate`
* Dispatch stops immediately

---

### 3.4.2 Dispatch Mode Resolution

Dispatch mode is controlled by:

```
WEBHOOK_DISPATCH_MODE
```

Supported modes:

| Mode             | Behavior                                  |
| ---------------- | ----------------------------------------- |
| `sync` (default) | Handler executes inline                   |
| `queued`         | Envelope is enqueued for async processing |

Invalid modes cause runtime failure at dispatch entry,
before any handler resolution or dispatch occurs.

---

### 3.4.3 Sync Dispatch Path

If mode is `sync`:

1. Resolve handler by `(integration + eventType)`
2. If no handler → ledger marked `ignored`
3. Invoke exactly one handler
4. On success → ledger marked `processed`
5. On error → ledger marked `failed`

The router:

* Never throws during handler execution
* Throws immediately on invalid dispatch mode configuration
* Never retries
* Never mutates the envelope

---

### 3.4.4 Queued Dispatch Path

If mode is `queued`:

1. Convert envelope → `WebhookDispatchJob`
2. Enqueue job exactly once
3. Return immediately
4. **No handler execution**
5. ** No ledger mutation beyond the initial received insert
(duplicate detection excepted) **

Queued dispatch is **non-blocking** and **replay-safe**.

---

## 4. Webhook Ledger (integration_webhook_events)

The ledger is the **only durable state** of webhook processing.

### Processing statuses

| Status      | Meaning                   |
| ----------- | ------------------------- |
| `received`  | Verified and accepted     |
| `duplicate` | Idempotency hit           |
| `ignored`   | Unsupported event         |
| `processed` | Domain mutation succeeded |
| `failed`    | Domain mutation failed    |

### Guarantees

* Each webhook produces **exactly one** ledger row
* Status transitions are monotonic after initial insert.
* Duplicate events are detected via a unique constraint violation and then explicitly marked duplicate in a follow-up update.
* No deletion or overwriting of history

---

## 5. Async Dispatch Job (Queued Mode)

Queued payloads use a **versioned, replay-safe job format**.

```ts
{
  version: 1,
  integration: string,
  eventId: string,
  eventType: string,
  rawPayload: unknown,
  shopId?: number,
  shopDomain?: string,
  enqueuedAt: string
}
```

Rules:

* JSON-serializable
* No Date objects
* No functions
* No runtime flags (e.g. `verified`)
* Safe to replay multiple times

---

## 6. Worker Re-entry

Workers:

* Consume dispatch jobs
* Reconstruct a minimal `WebhookEnvelope`
* Re-enter through `WebhookRouter.dispatch`

There is **no special replay path**.

This guarantees:

* Same invariants
* Same idempotency
* Same failure handling

---

## 7. Operator Replay

Operators can replay a webhook via:

```
POST /api/v1/webhooks/replay/:externalEventId
```

Replay behavior:

* Reads from ledger
* Reconstructs envelope
* Dispatches via router
* Fully idempotent
* Safe to repeat

This endpoint is **admin-only** by design.

---

## 8. What This System Does NOT Do (By Design)

* ❌ Automatic retries
* ❌ Exponential backoff
* ❌ Batch replay
* ❌ DLQ processing
* ❌ Silent recovery

These are deliberate omissions to preserve determinism and debuggability.

---

## 9. Mental Model (Memorize This)

> **Webhooks are events, not actions.
> The ledger is truth.
> The router is law.
> Handlers are disposable.**

If you hold this model, the system will never surprise you.

---
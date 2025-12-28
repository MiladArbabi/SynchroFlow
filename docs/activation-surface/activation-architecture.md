# 🧠 SynchroFlow Activation & Sync Architecture (Canonical)

## DATE: DEC 23, 2025

## Purpose

This document defines the **authoritative architecture, contracts, and invariants** for:

* Shopify integration
* Sync orchestration
* Canonical data ingestion
* FT0 activation completion
* Verification and debugging procedures

This is **not a guide**.
This is the **source of truth**.

Any change to behavior must be reflected here.

---

## High-Level Flow (Happy Path)

```
User connects Shopify
        ↓
Integration record created
        ↓
Sync job queued (sync_jobs)
        ↓
sync.worker processes job
        ↓
Shopify → Canonical ingestion
        ↓
First Insight computed
        ↓
FT0 evaluated and completed
```

---

## Core Concepts

### Integration

Represents a connected commerce platform (e.g. Shopify).

Table: `integrations`

Key fields:

* `shop_id`
* `platform`
* `platform_shop_name`
* `access_token_encrypted`
* `sync_status`

---

### Canonical Data

Normalized, platform-agnostic commerce data.

Tables:

* `canonical_orders`
* `canonical_order_line_items`
* `canonical_products` (non-blocking for FT0)

**Canonical IDs are globally stable and unique.**

---

### Sync Jobs

All real syncs run through the queue.

Queue:

* `sync_jobs`

Worker:

* `apps/backend/src/sync.worker.ts`

**No production logic depends on dev routes.**

---

## FT0 — Activation Phase Zero

### Definition (FINAL)

FT0 represents **system readiness**, not growth or optimization.

FT0 completes when **ALL** are true:

1. Shopify integration exists
2. Sync completed successfully
3. `canonical_orders > 0`
4. `users.first_insight_delivered = true`

Nothing else is allowed to gate FT0.

---

### Explicit Non-Requirements

The following must **never** block FT0:

* Product count
* Visitors or sessions
* SDK installation
* Conversion funnels
* Customer behavior signals

These belong to FT1+.

---

### Persistence

Table: `ft0_state`

Properties:

* Written **once**
* Idempotent
* Authoritative
* Never downgraded

---

### FT0 Completion Service

File:

```
apps/backend/src/services/ft0-completion.service.ts
```

Responsibilities:

* Evaluate FT0 conditions
* Write `ft0_state`
* Emit audit event exactly once

---

## First Insight

First Insight is a **commit latch**.

Table:

* `users.first_insight_delivered`

FT0 cannot complete without it.

This guarantees:

* Data ingestion succeeded
* Insight pipeline is operational
* User has received value

---

## Activation Audit Events

Table:

* `activation_audit_events`

Purpose:

* Immutable activation history
* Debugging & analytics
* Compliance and replay safety

Failures here must **never block FT0**.

---

## Verification Checklist (Debugging)

### Verify Sync

```sql
SELECT sync_status
FROM integrations
WHERE shop_id = <shop_id>;
```

Expected:

```
COMPLETED
```

---

### Verify Canonical Orders

```sql
SELECT COUNT(*)
FROM canonical_orders
WHERE shop_id = <shop_id>;
```

Expected:

```
> 0
```

---

### Verify First Insight

```sql
SELECT first_insight_delivered
FROM users
WHERE shop_id = <shop_id>;
```

Expected:

```
true
```

---

### Verify FT0 Completion

```sql
SELECT status, completed_at
FROM ft0_state
WHERE shop_id = <shop_id>;
```

Expected:

```
COMPLETED | <timestamp>
```

---

## Invariants (DO NOT BREAK)

* FT0 completion must be deterministic
* FT0 must never depend on traffic
* FT0 must never regress
* Sync must always run through the worker
* Canonical tables must enforce uniqueness

---

## Why This Matters

Silent activation failure is worse than explicit errors.

This architecture ensures:

* Predictable onboarding
* Clear phase boundaries
* No hidden conditions
* No “it works on my machine” logic

---

## Change Policy

Any change to:

* FT0 conditions
* Sync semantics
* Canonical constraints

**MUST** update:

1. This document
2. The service comment
3. Frontend activation expectations

No exceptions.

---

## Status

✅ Shopify sync pipeline stable
✅ Canonical ingestion validated
✅ FT0 completion deterministic
🔜 FT1 activation logic (next phase)

---
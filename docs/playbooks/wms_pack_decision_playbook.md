# WMS Pack Decision Request — Playbook

**LaSyncro | WMS-Lite Subsystem**
**Version:** 1.0
**Date:** May 30, 2026
**Status:** ✅ Live — shipped May 30, 2026
**Replaces:** WM-33 (planned `pack_exception_threads` pattern — retired)

---

## 1. Problem This Solves

Before this sprint, `item_missing` and `short_pick` exceptions during pack were
silently advancing the pack job with `partial_shipment=false` hardcoded. The owner
was never consulted. Orders shipped incomplete or stalled with no visibility.

---

## 2. Pattern — Pack Decision Request

A first-class decision object that **blocks the pack job** until an owner/admin
resolves it. Not a notification, not a chat thread — a persistent, auditable
decision with a clear lifecycle.

```
Packer hits item_missing or short_pick
  → PackDecisionRequest created (status: pending)
  → Pack job pauses on that order
  → Owner notified: push + Alert (warehouse_floor, audience: owner)
  → Owner sees pending strip in Problem Center
  → Owner approves (ship_partial=true|false) or rejects (requeue)
  → Packer gets green light or hold instruction
  → Decision auditable: who raised, who resolved, when, note
```

---

## 3. Schema

**Table:** `pack_decision_requests` (migration 0111)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | gen_random_uuid() |
| `shop_id` | int | RLS enforced |
| `pick_batch_id` | uuid | references pick_batches |
| `lasyncro_order_id` | uuid | references orders |
| `lasyncro_line_item_id` | uuid | affected line |
| `exception_type` | varchar | `item_missing` \| `short_pick` |
| `question` | varchar | `ship_partial` \| `hold_and_requeue` |
| `status` | varchar | `pending` \| `approved` \| `rejected` |
| `partial_shipment` | bool nullable | set by owner on approval |
| `raised_by` | int | references users.id |
| `raised_at` | timestamptz | |
| `resolved_by` | int nullable | references users.id |
| `resolved_at` | timestamptz nullable | |
| `note` | text nullable | owner's instruction to packer |

**Unique constraint:** `(shop_id, pick_batch_id, lasyncro_order_id, lasyncro_line_item_id)`
One pending request per order line per batch — prevents duplicate blocking.

**Indexes:**
- `idx_pack_decision_shop_status` — `(shop_id, status)`
- `idx_pack_decision_batch_status` — `(pick_batch_id, status)`
- `idx_pack_decision_order` — `(lasyncro_order_id)`

**RLS:** `pack_decision_requests_tenant_isolation` — `app.current_tenant::int`

---

## 4. API Endpoints

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| `POST` | `/api/v1/wms/pack/decision-request` | operator+ | Raise blocking request |
| `GET` | `/api/v1/wms/pack/decision-request/:id` | operator+ | Poll for resolution |
| `POST` | `/api/v1/wms/pack/decision-request/:id/resolve` | owner/admin | Approve or reject |
| `GET` | `/api/v1/wms/pack/decision-requests?status=pending` | owner/admin | List for Problem Center strip |

**Raise body:**
```json
{
  "pick_batch_id": "uuid",
  "lasyncro_order_id": "uuid",
  "lasyncro_line_item_id": "uuid",
  "exception_type": "item_missing",
  "question": "ship_partial"
}
```

**Resolve body:**
```json
{
  "status": "approved",
  "partial_shipment": true,
  "note": "Ship — customer notified about missing item"
}
```

---

## 5. Exception Classification

| Exception type | Blocking? | Flow |
|----------------|-----------|------|
| `item_missing` | ✅ Yes | Raise decision request → await owner |
| `short_pick` | ✅ Yes | Raise decision request → await owner |
| `product_defect` | ❌ No | Problem bin → advance immediately |
| `packaging_defect` | ❌ No | Problem bin → advance immediately |
| `wrong_item` | ❌ No | Problem bin → advance immediately |

---

## 6. Frontend Surfaces

### Mobile — `apps/mobile/src/screens/PackScreen.tsx`
- `item_missing` / `short_pick` → raises decision request → `awaiting_decision` screen phase
- Polls `GET /pack/decision-request/:id` every 4s
- `approved` → advances with `partial_shipment` flag set
- `rejected` → skips order, shows owner note
- Cleanup: poll timer cleared on unmount

### Web — `modules/wms/src/ui/pages/PackSessionPage.tsx`
- Same logic as mobile — `awaiting_decision` ScanState phase
- Exception dialog split into blocking (warning) / non-blocking (error/default) sections
- `short_pick` added to exception dialog (was missing on web)

### Problem Center — `apps/frontend/src/pages/ft2-pages/ProblemCenterPage.tsx`
- `PendingDecisionsStrip` shown above exceptions table when `requests.length > 0`
- Polls `GET /pack/decision-requests?status=pending` every 10s
- "Ship partial" (approve) / "Hold order" (reject) with optional note dialog
- Optimistic removal from pending list on action

---

## 7. Notification Flow

```
PackDecisionRequest raised
  → firePickExceptionAlert() → wms_pack_exception alert
    audience: owner, category: warehouse_floor
    deep links to /problem-center
  → dispatchNotification() → push to owner role
    body: "Pack decision needed — item missing. Batch XXXXXXXX. Packer is waiting."
```

---

## 8. Service Layer

**File:** `apps/backend/src/services/wms/packDecision.service.ts`

| Function | Description |
|----------|-------------|
| `raisePackDecisionRequest` | Creates request, idempotent on retry, fires alert + push |
| `getPackDecisionRequest` | Fetch by id + shop — used by mobile poll |
| `resolvePackDecisionRequest` | Owner approve/reject, validates pending status |

---

## 9. Role Enforcement

| Action | Allowed roles |
|--------|--------------|
| Raise decision request | Any authenticated user (operator, owner, admin) |
| Poll decision status | Any authenticated user |
| Resolve (approve/reject) | owner, admin only — enforced at controller + service layer |
| List pending decisions | owner, admin only — `wms:batch:release` action gate |

---

## 10. What Was Retired

**WM-33 `pack_exception_threads`** — the original planned pattern using a jsonb
messages array for owner-operator threading. Retired in favour of
`pack_decision_requests` which is:
- Simpler schema (no jsonb, no message threading)
- First-class lifecycle (pending → approved/rejected)
- Auditable (who raised, who resolved, timestamps)
- Real-time (polling, not long-poll or websocket needed at this scale)

---

## 11. Open / Fast-Follow

- Alert `wms_pack_exception` deep link currently points to `/problem-center` ✅
- Rejected decisions should requeue the order back to the order pool (backend — not yet implemented)
- Decision history visible in order detail page (fast-follow)
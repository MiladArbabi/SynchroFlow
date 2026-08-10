# INV-BLOCK-10a — Shopify cancellation ingress

**Date:** 2026-08-10 · **Status:** CLOSED · **Scope:** commercial only, zero inventory mutation

## Defect

Shopify sends `orders/cancelled`. laSyncro had never registered the topic, so
`shopify.webhook.router.ts` fell through to `default:` and returned
`HTTP 200 {"status":"ignored"}` **without reaching `shopifyWebhookHandler`** —
so not even the router's own `unsupported_event` ledger and `domain_events`
audit path ran. The event vanished with no trace.

Consequence chain:

no ingress
-> order_fulfillment_status never reaches 'cancelled'
-> pickBatch.service.ts pool filter (status IN pending/processing) never excludes it
-> laSyncro releases, picks, packs and ships an order the merchant cancelled


Three enum values (`fulfillment_status_type.cancelled`,
`order_warehouse_status_type.cancelled`, `stow_task_trigger.order_cancelled_mid_pick`),
the ingestion precedence rank 4 with its explicit override clause, and the
billing exclusion at `wms.controller.ts:1414` were all scaffolding for a
feature that had never been built.

## Change

No migration. `domain_events.event_type` is varchar. `read_orders` scope already granted.

| File | Change |
|---|---|
| `services/shopify/shopifyWebhooks.core.ts` | topic list + `GRAPHQL_TOPIC_MAP` -> `ORDERS_CANCELLED` |
| `api/shopify/shopify.webhook.router.ts` | `case 'orders/cancelled'` -> `shopifyWebhookHandler` |
| `api/shopify/handlers/handleOrderCancelled.ts` | NEW — envelope guards, installation resolution, `domain_events` insert |
| `api/shopify/handlers/index.ts` | export |
| `api/shopify/shopify.webhook.ts` | `WebhookRouter.register` |
| `projection/handlers/orders.cancelled.ts` | NEW — `ingestStatus({status:'cancelled'})` |
| `projection/projection.registry.ts` | `'orders/cancelled'` key |
| `projection/projection.engine.ts` | added to `isOrderEntityEvent` |

`extractExternalOrderId` unchanged — `orders/cancelled` carries a full order
payload and falls through to `payload?.id`.

### Event-time contract

`cancelled_at` takes precedence over `updated_at`. `updated_at` moves on
unrelated edits and is a fallback only.

### Idempotency — two layers

1. **Router ledger** (primary): `[WEBHOOK_DUPLICATE_STOPPED_AT_ROUTER]` — a replayed
   delivery never reaches the handler.
2. **`23505` on `(shop_id, external_event_id)`** (secondary): retained because direct
   `domain_events` writes from backfill paths bypass the ledger.

## Runtime proof

POST /api/v1/shopify/webhooks topic=orders/cancelled (HMAC-signed)
-> HTTP 200 {"status":"ok"}
-> [ORDER_CANCELLED_HANDLER_ENTRY]
-> domain_events id=16, external_event_id ...:cancelled
event_time = 14:30 (payload cancelled_at=14:30, updated_at=09:00)
-> order_fulfillment_status 800002: pending -> cancelled
status_updated_at = 14:30 (canonical event time, not wall clock)
-> cursor 15 -> 16, lag 0
-> 800001 / 800003 untouched


Replay (earlier run, same fixture): second identical delivery produced no second
domain event; stopped at the router ledger.

## Explicitly NOT in scope — see INV-BLOCK-10b

- reservation release for a cancelled order
- `order_cancelled_mid_pick` stow task creation
- batch adjustment / completion cardinality
- new `movement_type` for cancellation restock
- deactivating `order_constraints` on cancellation (a cancelled order still
  counts toward `constrainedOrders` / `queueAwaitingInventory`)

## UI verification — and a defect it exposed

Order Flow after cancelling 800002:

3 blocked · $179.85 held · 0 ready to release
OUT OF STOCK · 3 -> 
#800002 listed "Not enough stock to fulfill"
Blocked · unbatched 3
Ready 0


Release is correctly impossible (Ready 0). But the cancelled order still appears
as an actionable blocker and still counts toward held revenue, because the
blocked list reads `order_constraints` — which cancellation does not deactivate.

Registered as **INV-BLOCK-10c** (separate issue, not a 10a regression: the row
was equally stale before, merely unreachable). The constraint evaluator has zero
`cancelled` awareness, so the correct deactivation site needs its own audit.

`POOL-EXCL-VERIFY-01`: the `ofs.status IN (pending, processing)` filter could not
be isolated at runtime — every dev order also carried an active
`inventory/oversell` constraint, so `whereNotExists(order_constraints)` already
excluded them. The filter is pre-existing unmodified code.

## Fixture requirement

The webhook path needs a `shopify_app_installations` row or the handler returns
at the installation guard (HTTP 500 upstream). `db:reset` destroys it:

```sql
INSERT INTO shopify_app_installations
  (shop_id, shop_domain, access_token, scopes, installed_at, created_at, updated_at)
VALUES (1, 'test.myshopify.com', 'dev-fixture-token', 'read_orders', now(), now(), now());
```

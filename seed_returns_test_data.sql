-- ============================================================
-- seed_returns_test_data.sql — LaSyncro Returns module reviewer seed
-- Rewritten 2026-07-07: dev_seed.ts randomizes SKUs/order numbers on
-- every db:reset — no external_order_id or sku is stable across resets.
-- Picks N distinct order/line-item pairs BY POSITION (temp table,
-- ROW_NUMBER over a stable sort) instead of by identity. Same 11 test
-- scenarios in shape every run, whatever the fixture data actually is.
-- ============================================================
SET LOCAL "app.current_tenant" = '1';

DROP TABLE IF EXISTS _seed_return_candidates;
CREATE TEMP TABLE _seed_return_candidates AS
SELECT
  oru.lasyncro_revenue_unit_id, oru.lasyncro_order_id, oru.line_total, oru.quantity,
  ROW_NUMBER() OVER (ORDER BY o.lasyncro_order_id, oli.sku) AS rn
FROM order_revenue_units oru
JOIN orders o ON o.lasyncro_order_id = oru.lasyncro_order_id
JOIN order_line_items oli ON oli.lasyncro_variant_id = oru.lasyncro_variant_id AND oli.lasyncro_order_id = oru.lasyncro_order_id
WHERE o.shop_id = 1;

-- ---- 1: damaged, awaiting_decision ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-01', line_total, NOW() - INTERVAL '10 days'
FROM _seed_return_candidates WHERE rn = 1
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'awaiting_decision', 'system_auto', re.executed_at, NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-01'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, refunded_amount, item_condition, quantity_received, condition_notes, processed_at, source)
SELECT gen_random_uuid(), re.lasyncro_refund_execution_id, c.lasyncro_revenue_unit_id, rj.return_job_id, c.quantity, c.line_total, 'damaged', c.quantity, 'Seam torn on arrival, photographed', re.executed_at + INTERVAL '2 hours', 'refund_webhook'
FROM refund_executions re
JOIN return_jobs rj ON rj.lasyncro_refund_execution_id = re.lasyncro_refund_execution_id
JOIN _seed_return_candidates c ON c.rn = 1
WHERE re.external_refund_id = 'seed-ret-01'
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 2: fresh Type A, 'ok' orphan bucket ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-02', line_total, NOW() - INTERVAL '3 hours'
FROM _seed_return_candidates WHERE rn = 2
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'pending', 'system_auto', re.executed_at, NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-02'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 3: 72h old, 'warning' orphan bucket ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-03', line_total, NOW() - INTERVAL '72 hours'
FROM _seed_return_candidates WHERE rn = 3
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'pending', 'system_auto', re.executed_at, NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-03'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 4: 200h old, 'critical' orphan bucket ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-04', line_total, NOW() - INTERVAL '200 hours'
FROM _seed_return_candidates WHERE rn = 4
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'pending', 'system_auto', re.executed_at, NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-04'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 5: repackable, processed ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-05', line_total, NOW() - INTERVAL '5 days'
FROM _seed_return_candidates WHERE rn = 5
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'in_progress', 'system_auto', re.executed_at, NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-05'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, refunded_amount, item_condition, quantity_received, processed_at, source)
SELECT gen_random_uuid(), re.lasyncro_refund_execution_id, c.lasyncro_revenue_unit_id, rj.return_job_id, c.quantity, c.line_total, 'repackable', c.quantity, re.executed_at + INTERVAL '1 hour', 'refund_webhook'
FROM refund_executions re
JOIN return_jobs rj ON rj.lasyncro_refund_execution_id = re.lasyncro_refund_execution_id
JOIN _seed_return_candidates c ON c.rn = 5
WHERE re.external_refund_id = 'seed-ret-05'
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 6: resellable, complete, recovery rate ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at, return_reason)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-06', line_total, NOW() - INTERVAL '6 days', 'changed_mind'
FROM _seed_return_candidates WHERE rn = 6
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, completed_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'complete', 'system_auto', re.executed_at, re.executed_at + INTERVAL '4 hours', NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-06'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, refunded_amount, item_condition, quantity_received, processed_at, source)
SELECT gen_random_uuid(), re.lasyncro_refund_execution_id, c.lasyncro_revenue_unit_id, rj.return_job_id, c.quantity, c.line_total, 'resellable', c.quantity, re.executed_at + INTERVAL '2 hours', 'refund_webhook'
FROM refund_executions re
JOIN return_jobs rj ON rj.lasyncro_refund_execution_id = re.lasyncro_refund_execution_id
JOIN _seed_return_candidates c ON c.rn = 6
WHERE re.external_refund_id = 'seed-ret-06'
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 7: unsellable, write_off, resolved (owner_decision now on the LINE) ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at, return_reason)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-07', line_total, NOW() - INTERVAL '8 days', 'damaged_on_arrival'
FROM _seed_return_candidates WHERE rn = 7
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, completed_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'complete', 'system_auto', re.executed_at, re.executed_at + INTERVAL '1 day', NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-07'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, refunded_amount, item_condition, quantity_received, condition_notes, processed_at, source, owner_decision, decision_notes, decision_by, decision_at)
SELECT gen_random_uuid(), re.lasyncro_refund_execution_id, c.lasyncro_revenue_unit_id, rj.return_job_id, c.quantity, c.line_total, 'unsellable', c.quantity, 'Crushed in transit, unsellable', re.executed_at + INTERVAL '2 hours', 'refund_webhook', 'write_off', 'Crushed in transit, unsellable', 1, re.executed_at + INTERVAL '1 day'
FROM refund_executions re
JOIN return_jobs rj ON rj.lasyncro_refund_execution_id = re.lasyncro_refund_execution_id
JOIN _seed_return_candidates c ON c.rn = 7
WHERE re.external_refund_id = 'seed-ret-07'
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 8: damaged, reship, resolved ----
INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at, return_reason)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-08', line_total, NOW() - INTERVAL '4 days', 'wrong_item'
FROM _seed_return_candidates WHERE rn = 8
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, completed_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'complete', 'system_auto', re.executed_at, re.executed_at + INTERVAL '6 hours', NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-08'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, refunded_amount, item_condition, quantity_received, processed_at, source, owner_decision, decision_by, decision_at)
SELECT gen_random_uuid(), re.lasyncro_refund_execution_id, c.lasyncro_revenue_unit_id, rj.return_job_id, c.quantity, c.line_total, 'damaged', c.quantity, re.executed_at + INTERVAL '1 hour', 'refund_webhook', 'reship', 1, re.executed_at + INTERVAL '6 hours'
FROM refund_executions re
JOIN return_jobs rj ON rj.lasyncro_refund_execution_id = re.lasyncro_refund_execution_id
JOIN _seed_return_candidates c ON c.rn = 8
WHERE re.external_refund_id = 'seed-ret-08'
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- ---- 9: Type B undelivered, open, 'warning' orphan ----
INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_order_id, status, undelivered_reason, source, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'undelivered_return', lasyncro_order_id, 'awaiting_decision', 'not_claimed', 'carrier_webhook', NOW() - INTERVAL '80 hours', NOW()
FROM _seed_return_candidates WHERE rn = 9
AND NOT EXISTS (SELECT 1 FROM return_jobs rj2 JOIN _seed_return_candidates c2 ON c2.lasyncro_order_id = rj2.lasyncro_order_id WHERE c2.rn = 9 AND rj2.origin = 'undelivered_return');

-- ---- 10: Type B undelivered, resolved (reship) ----
INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_order_id, status, undelivered_reason, owner_decision, decision_at, source, created_at, completed_at, updated_at)
SELECT gen_random_uuid(), 1, 'undelivered_return', lasyncro_order_id, 'complete', 'wrong_address', 'reship', NOW() - INTERVAL '5 days' + INTERVAL '3 hours', 'carrier_webhook', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '3 hours', NOW()
FROM _seed_return_candidates WHERE rn = 10
AND NOT EXISTS (SELECT 1 FROM return_jobs rj2 JOIN _seed_return_candidates c2 ON c2.lasyncro_order_id = rj2.lasyncro_order_id WHERE c2.rn = 10 AND rj2.origin = 'undelivered_return');

-- ---- 11: scan-intake manual line, no refund yet ----
INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_order_id, status, source, claimed_by, claimed_at, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', lasyncro_order_id, 'in_progress', 'scan_intake', 1, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours', NOW()
FROM _seed_return_candidates WHERE rn = 11
AND NOT EXISTS (SELECT 1 FROM return_jobs rj2 JOIN _seed_return_candidates c2 ON c2.lasyncro_order_id = rj2.lasyncro_order_id WHERE c2.rn = 11 AND rj2.source = 'scan_intake');

INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, item_condition, quantity_received, processed_by, processed_at, source)
SELECT gen_random_uuid(), NULL, c.lasyncro_revenue_unit_id, rj.return_job_id, c.quantity, 'resellable', c.quantity, 1, NOW() - INTERVAL '2 hours', 'scan_intake_manual'
FROM _seed_return_candidates c
JOIN return_jobs rj ON rj.lasyncro_order_id = c.lasyncro_order_id AND rj.source = 'scan_intake'
WHERE c.rn = 11
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE return_job_id = rj.return_job_id);

-- ---- 12: multi-line order, damaged + unsellable, BOTH undecided ----
-- Real test case for the per-line decision fix — proves a job with two
-- damaged/unsellable lines stays awaiting_decision until BOTH lines are
-- decided, and that deciding one line's write_off doesn't touch the other.
DROP TABLE IF EXISTS _seed_multiline_order;
CREATE TEMP TABLE _seed_multiline_order AS
SELECT oru.lasyncro_order_id
FROM order_revenue_units oru
JOIN orders o ON o.lasyncro_order_id = oru.lasyncro_order_id
WHERE o.shop_id = 1
GROUP BY oru.lasyncro_order_id
HAVING count(*) >= 2
ORDER BY oru.lasyncro_order_id
LIMIT 1;

DROP TABLE IF EXISTS _seed_multiline_lines;
CREATE TEMP TABLE _seed_multiline_lines AS
SELECT oru.lasyncro_revenue_unit_id, oru.line_total, oru.quantity,
  ROW_NUMBER() OVER (ORDER BY oru.lasyncro_revenue_unit_id) AS ln
FROM order_revenue_units oru
WHERE oru.lasyncro_order_id = (SELECT lasyncro_order_id FROM _seed_multiline_order)
LIMIT 2;

INSERT INTO refund_executions (lasyncro_refund_execution_id, lasyncro_order_id, platform, external_refund_id, total_refund_amount, executed_at)
SELECT gen_random_uuid(), lasyncro_order_id, 'shopify', 'seed-ret-12', (SELECT SUM(line_total) FROM _seed_multiline_lines), NOW() - INTERVAL '9 days'
FROM _seed_multiline_order
ON CONFLICT (platform, external_refund_id) DO NOTHING;

INSERT INTO return_jobs (return_job_id, shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, updated_at)
SELECT gen_random_uuid(), 1, 'customer_return', re.lasyncro_refund_execution_id, re.lasyncro_order_id, 'awaiting_decision', 'system_auto', re.executed_at, NOW()
FROM refund_executions re WHERE re.external_refund_id = 'seed-ret-12'
AND NOT EXISTS (SELECT 1 FROM return_jobs WHERE lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- Line 1: damaged
INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, refunded_amount, item_condition, quantity_received, condition_notes, processed_at, source)
SELECT gen_random_uuid(), re.lasyncro_refund_execution_id, l.lasyncro_revenue_unit_id, rj.return_job_id, l.quantity, l.line_total, 'damaged', l.quantity, 'Box crushed corner, item scuffed', re.executed_at + INTERVAL '1 hour', 'refund_webhook'
FROM refund_executions re
JOIN return_jobs rj ON rj.lasyncro_refund_execution_id = re.lasyncro_refund_execution_id
JOIN _seed_multiline_lines l ON l.ln = 1
WHERE re.external_refund_id = 'seed-ret-12'
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE lasyncro_revenue_unit_id = l.lasyncro_revenue_unit_id AND lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

-- Line 2: unsellable
INSERT INTO refund_execution_line_items (lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id, return_job_id, refunded_quantity, refunded_amount, item_condition, quantity_received, condition_notes, processed_at, source)
SELECT gen_random_uuid(), re.lasyncro_refund_execution_id, l.lasyncro_revenue_unit_id, rj.return_job_id, l.quantity, l.line_total, 'unsellable', l.quantity, 'Water damage, unsellable', re.executed_at + INTERVAL '1 hour', 'refund_webhook'
FROM refund_executions re
JOIN return_jobs rj ON rj.lasyncro_refund_execution_id = re.lasyncro_refund_execution_id
JOIN _seed_multiline_lines l ON l.ln = 2
WHERE re.external_refund_id = 'seed-ret-12'
AND NOT EXISTS (SELECT 1 FROM refund_execution_line_items WHERE lasyncro_revenue_unit_id = l.lasyncro_revenue_unit_id AND lasyncro_refund_execution_id = re.lasyncro_refund_execution_id);

DROP TABLE IF EXISTS _seed_multiline_lines;
DROP TABLE IF EXISTS _seed_multiline_order;

-- ============================================================
-- BROWSER VERIFICATION FIXTURES — Order Detail returned-package CTA
-- ============================================================
-- Two fixtures for the "Package returned" CTA on Order Detail
-- (OrderDetailModalBody). Post RET-CTA-DECOUPLE the CTA needs only:
--   1. an ACTIVE order_constraints row
--      (constraint_type 'operational', block_type 'returned_undelivered',
--       target_id = the return_job_id)   → supplies target_id/target_status
--   2. the linked return_jobs.status     → picks the label + route
-- No `decisions` row is required for either fixture.
--
-- Label / route mapping (OrderDetailModalBody):
--   status pending | in_progress  → "Process return" → /wms?returnJobId=
--   status awaiting_decision      → "Review return"  → /returns/items?returnJobId=
--
-- A — PROCESS RETURN is a self-contained fixture-owned order with fixed
--     md5-derived UUIDs and external_order_id 900099. It does NOT depend
--     on _seed_return_candidates, rn position, candidate availability, or
--     any rebuild-created constraint state, so it is stable on every reset.
-- B — REVIEW RETURN still extends the always-present scenario-9
--     undelivered job (rn9) — unchanged.
--
-- TRANSACTION: order_fulfillment_status and order_constraints both carry
-- the migration-0076 BEFORE INSERT/UPDATE/DELETE trigger that raises
-- [PROJECTION_WRITE_VIOLATION] unless synchroflow.projection = 'true', and
-- FORCED RLS keyed on app.current_tenant. This file runs under `psql -f`
-- with no --single-transaction, where a top-level SET LOCAL is discarded
-- before the next statement, so these writes need their own explicit
-- transaction for SET LOCAL to hold. Session-global SET is deliberately
-- NOT used.
-- ============================================================

BEGIN;

SET LOCAL "app.current_tenant" = '1';
SET LOCAL "synchroflow.projection" = 'true';

-- ==== A: PROCESS RETURN — fixture-owned deterministic order ===========
-- Five-row graph, every id derived from
--   md5('lasyncro:browser-fixture:process-return'[:<part>])::uuid
-- so the fixture is fully reproducible and idempotent with no reference
-- to seeded commerce data. No order_revenue_units / line items: an
-- undelivered pending job renders ReturnSessionPage meaningfully with
-- zero lines ("scan the physical product barcode below").

-- 1. orders
INSERT INTO orders (
  lasyncro_order_id, shop_id, payment_state, currency,
  total_price, subtotal_price, total_tax,
  order_created_at, order_updated_at, created_at, updated_at,
  aggregate_version, last_projected_version
)
SELECT
  md5('lasyncro:browser-fixture:process-return')::uuid, 1, 'paid', 'USD',
  0, 0, 0,
  NOW() - INTERVAL '30 hours', NOW() - INTERVAL '30 hours',
  NOW() - INTERVAL '30 hours', NOW(),
  1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM orders
  WHERE lasyncro_order_id = md5('lasyncro:browser-fixture:process-return')::uuid
);

-- 2. external_order_identity_map  (external_order_id CHECK: digits only)
INSERT INTO external_order_identity_map (
  lasyncro_order_id, shop_id, platform, external_order_id
)
SELECT
  md5('lasyncro:browser-fixture:process-return')::uuid, 1, 'shopify', '900099'
ON CONFLICT (shop_id, platform, external_order_id) DO NOTHING;

-- 3. order_fulfillment_status  (UNIQUE on lasyncro_order_id; projection-guarded)
INSERT INTO order_fulfillment_status (
  lasyncro_fulfillment_id, lasyncro_order_id, status, status_updated_at
)
SELECT
  md5('lasyncro:browser-fixture:process-return:fulfillment')::uuid,
  md5('lasyncro:browser-fixture:process-return')::uuid,
  'pending', NOW() - INTERVAL '30 hours'
ON CONFLICT (lasyncro_order_id) DO NOTHING;

-- 4. return_jobs  (deterministic PK; no refund execution)
INSERT INTO return_jobs (
  return_job_id, shop_id, lasyncro_order_id, origin, status,
  lasyncro_refund_execution_id, undelivered_reason, source, notes,
  created_at, updated_at
)
SELECT
  md5('lasyncro:browser-fixture:process-return:return-job')::uuid,
  1, md5('lasyncro:browser-fixture:process-return')::uuid,
  'undelivered_return', 'pending',
  NULL, 'wrong_address', 'carrier_webhook',
  'FIXTURE:BROWSER-VERIFY:PROCESS_RETURN',
  NOW() - INTERVAL '30 hours', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM return_jobs
  WHERE return_job_id = md5('lasyncro:browser-fixture:process-return:return-job')::uuid
);

-- 5. order_constraints  (active returned_undelivered; projection-guarded;
--    do not duplicate an active row for this scope)
INSERT INTO order_constraints (
  constraint_id, lasyncro_order_id, constraint_type, block_type, target_id,
  started_at, resolved_at, is_active, write_source, created_at
)
SELECT
  md5('lasyncro:browser-fixture:process-return:constraint')::uuid,
  md5('lasyncro:browser-fixture:process-return')::uuid,
  'operational', 'returned_undelivered',
  md5('lasyncro:browser-fixture:process-return:return-job')::uuid,
  NOW() - INTERVAL '30 hours', NULL, TRUE,
  'seed_returns_test_data:browser_verify', NOW() - INTERVAL '30 hours'
WHERE NOT EXISTS (
  SELECT 1 FROM order_constraints oc
  WHERE oc.lasyncro_order_id = md5('lasyncro:browser-fixture:process-return')::uuid
    AND oc.constraint_type = 'operational'
    AND oc.target_id = md5('lasyncro:browser-fixture:process-return:return-job')::uuid
    AND oc.is_active = TRUE
);

-- ==== B: REVIEW RETURN — extend the existing rn9 undelivered job =======
-- rn9 already creates origin='undelivered_return' /
-- status='awaiting_decision'. Reused as-is; only the missing pieces
-- (marker, damaged line, constraint, decision) are added. UNCHANGED.
DROP TABLE IF EXISTS _seed_verify_review;
CREATE TEMP TABLE _seed_verify_review AS
SELECT c.lasyncro_order_id, c.lasyncro_revenue_unit_id, c.quantity, rj.return_job_id
FROM _seed_return_candidates c
JOIN return_jobs rj
  ON rj.lasyncro_order_id = c.lasyncro_order_id
 AND rj.origin = 'undelivered_return'
 AND rj.status = 'awaiting_decision'
WHERE c.rn = 9;

UPDATE return_jobs rj
SET notes = 'FIXTURE:BROWSER-VERIFY:REVIEW_RETURN', updated_at = NOW()
FROM _seed_verify_review r
WHERE rj.return_job_id = r.return_job_id
  AND rj.notes IS DISTINCT FROM 'FIXTURE:BROWSER-VERIFY:REVIEW_RETURN';

-- Damaged line linked ONLY by return_job_id — an undelivered_return job
-- has no refund execution (lasyncro_refund_execution_id stays NULL), the
-- scan-intake shape the schema already supports.
INSERT INTO refund_execution_line_items (
  lasyncro_refund_line_item_id, lasyncro_refund_execution_id, lasyncro_revenue_unit_id,
  return_job_id, refunded_quantity, item_condition, quantity_received,
  condition_notes, processed_at, source
)
SELECT
  gen_random_uuid(), NULL, r.lasyncro_revenue_unit_id, r.return_job_id,
  GREATEST(r.quantity, 1), 'damaged', GREATEST(r.quantity, 1),
  'Parcel returned by carrier, contents damaged in transit',
  NOW() - INTERVAL '2 hours', 'scan_intake_manual'
FROM _seed_verify_review r
WHERE NOT EXISTS (
  SELECT 1 FROM refund_execution_line_items reli
  WHERE reli.return_job_id = r.return_job_id
);

-- Active returned_undelivered constraint for the REVIEW fixture.
-- Mirrors ensureReturnedUndeliveredConstraint (returnJobs.service.ts).
-- Guarded by uniq_active_constraint_per_scope, so NOT EXISTS keeps re-runs
-- idempotent.
INSERT INTO order_constraints (
  constraint_id, lasyncro_order_id, constraint_type, block_type, target_id,
  started_at, resolved_at, is_active, write_source, created_at
)
SELECT
  gen_random_uuid(), rj.lasyncro_order_id, 'operational', 'returned_undelivered',
  rj.return_job_id, rj.created_at, NULL, TRUE,
  'seed_returns_test_data:browser_verify', rj.created_at
FROM return_jobs rj
WHERE rj.shop_id = 1
  AND rj.notes = 'FIXTURE:BROWSER-VERIFY:REVIEW_RETURN'
  AND NOT EXISTS (
    SELECT 1 FROM order_constraints oc
    WHERE oc.lasyncro_order_id = rj.lasyncro_order_id
      AND oc.constraint_type = 'operational'
      AND oc.target_id = rj.return_job_id
      AND oc.is_active = TRUE
  );

-- open_return_job decision for the REVIEW fixture only. id reproduces
-- decision.engine.ts buildDecision() exactly:
--   sha256('decision:<orderId>:<aggVer>:<action.type>:<stable payload>')
-- truncated to 32 hex chars — a later real engine run for the same order
-- collides on the PK and is ignored rather than producing a duplicate.
-- The PROCESS fixture deliberately gets NO decision row (RET-CTA-DECOUPLE:
-- the CTA is driven by the active returned_undelivered workflow itself).
INSERT INTO decisions (
  id, type, entity_id, aggregate_version, priority, score_breakdown, reason,
  signals, recommended_action, actions, status, lifecycle, shop_id,
  created_at, updated_at
)
SELECT
  substr(encode(digest(
    'decision:' || rj.lasyncro_order_id::text ||
    ':1:open_return_job:{"block_type":"returned_undelivered"}', 'sha256'
  ), 'hex'), 1, 32)::uuid,
  'operational',
  rj.lasyncro_order_id::text,
  1,
  100,
  '{"health":40,"aging":0,"sla":0,"inventory":0,"customer":0,"operational":100}'::jsonb,
  'FIXTURE:BROWSER-VERIFY — Derived from open_return_job',
  '{"inventory_blocked":false,"customer_blocked":false,"operational_blocked":true,"health_score":40}'::jsonb,
  '{"type":"open_return_job","payload":{"block_type":"returned_undelivered"},"execution_mode":"manual"}'::jsonb,
  '[{"type":"open_return_job","payload":{"block_type":"returned_undelivered"},"execution_mode":"manual"}]'::jsonb,
  'pending',
  '{"started_at":null,"resolved_at":null,"outcome":null}'::jsonb,
  1,
  rj.created_at,
  NOW()
FROM return_jobs rj
WHERE rj.shop_id = 1
  AND rj.notes = 'FIXTURE:BROWSER-VERIFY:REVIEW_RETURN'
ON CONFLICT (id) DO NOTHING;

-- ---- Fixture report ---------------------------------------------------
SELECT
  CASE rj.notes
    WHEN 'FIXTURE:BROWSER-VERIFY:PROCESS_RETURN' THEN 'A — Process return  (/wms?returnJobId=)'
    ELSE                                              'B — Review return   (/returns/items?returnJobId=)'
  END                                   AS fixture,
  eoim.external_order_id                AS external_order_id,
  rj.return_job_id                      AS return_job_id,
  rj.status                             AS return_status,
  rj.notes                              AS marker,
  oc.write_source                       AS constraint_marker,
  d.reason                              AS decision_marker
FROM return_jobs rj
LEFT JOIN external_order_identity_map eoim
       ON eoim.lasyncro_order_id = rj.lasyncro_order_id
LEFT JOIN order_constraints oc
       ON oc.target_id = rj.return_job_id
      AND oc.constraint_type = 'operational'
      AND oc.block_type = 'returned_undelivered'
      AND oc.is_active = TRUE
LEFT JOIN decisions d
       ON d.entity_id = rj.lasyncro_order_id::text
      AND d.shop_id = 1
      AND d.recommended_action->>'type' = 'open_return_job'
WHERE rj.shop_id = 1
  AND rj.notes IN ('FIXTURE:BROWSER-VERIFY:PROCESS_RETURN', 'FIXTURE:BROWSER-VERIFY:REVIEW_RETURN')
ORDER BY rj.notes;

DROP TABLE IF EXISTS _seed_verify_review;

COMMIT;

DROP TABLE IF EXISTS _seed_return_candidates;
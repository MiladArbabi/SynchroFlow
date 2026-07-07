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
DROP TABLE IF EXISTS _seed_return_candidates;
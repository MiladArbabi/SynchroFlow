-- Inventory obligation invariants (v1)

-- 1. Every execution row is evaluated
SELECT
  COUNT(*) FILTER (WHERE has_inventory_block IS NULL) AS unevaluated
FROM order_fulfillment_status;

-- Must be 0

-- 2. No false positives
SELECT COUNT(*) AS invalid_blocks
FROM order_fulfillment_status ofs
JOIN canonical_order_line_items li
  ON li.canonical_order_id = ofs.canonical_order_id
JOIN inventory_truth it
  ON it.shop_id = li.shop_id
 AND it.sku     = li.sku
WHERE ofs.has_inventory_block = true
  AND (it.quantity_available - it.quantity_reserved - it.quantity_buffer) > 0;

-- Must be 0

-- 3. Missing inventory never blocks
SELECT COUNT(*) AS invalid_missing_inventory_blocks
FROM order_fulfillment_status ofs
LEFT JOIN canonical_order_line_items li
  ON li.canonical_order_id = ofs.canonical_order_id
LEFT JOIN inventory_truth it
  ON it.shop_id = li.shop_id
 AND it.sku     = li.sku
WHERE it.sku IS NULL
  AND ofs.has_inventory_block = true;

-- Must be 0

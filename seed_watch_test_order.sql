-- seed_watch_test_order.sql
-- Standalone: one order landing cleanly in Watch (unfulfilled, not yet
-- SLA-breached), reusing an existing seeded product/variant so no new
-- product data is needed. order_created_at ~30h ago (crosses the 24h
-- creation-age Watch threshold), paid_at ~2h ago (does NOT cross the
-- 24h paid-age SLA-breach threshold) — avoids the ambiguity found live
-- in existing seed data, where created_at and paid_at land at the same
-- instant and both thresholds cross together.
-- Reuses variant 7ea4ee28-fbe6-bfd1-a60a-04c88f2f697b (APP-82994-8018,
-- SKU used in every screenshot this session) via its Shopify GID.
-- inventory_truth is confirmed empty (0 rows) — this order will
-- naturally evaluate as inventory-blocked by evaluateInventoryConstraint
-- once reconciliation runs, no manual constraint insert needed.

-- seed_watch_test_order_v2.sql
INSERT INTO domain_events (shop_id, event_type, event_payload, event_time, external_event_id)
VALUES
(1, 'orders/paid', '{"id":"900098"}'::jsonb, NOW() - INTERVAL '2 hours', '900098:paid'),
(1, 'orders/sync', (
  '{"id":"900098","name":"#2098","customer":{"id":"gid://shopify/Customer/27125114274162"},"createdAt":"' ||
  to_char(NOW() - INTERVAL '50 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
  '","lineItems":{"edges":[{"node":{"id":"gid://shopify/LineItem/900098001","product":{"id":"gid://shopify/Product/14838669082994"},"variant":{"id":"gid://shopify/ProductVariant/60837614748018"},"quantity":1,"originalTotalSet":{"shopMoney":{"amount":"820.00"}},"originalUnitPriceSet":{"shopMoney":{"amount":"820.00"}},"discountedUnitPriceSet":{"shopMoney":{"amount":"820.00"}}}}]},"updatedAt":"' ||
  to_char(NOW() - INTERVAL '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
  '","sourceName":"web","processedAt":"' ||
  to_char(NOW() - INTERVAL '50 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
  '","totalTaxSet":{"shopMoney":{"amount":"0.0"}},"currencyCode":"USD","totalPriceSet":{"shopMoney":{"amount":"820.00","currencyCode":"USD"}},"shippingAddress":{"zip":"94107","city":"San Francisco","name":"Watch Test Customer 2","phone":null,"address1":"500 Test St","address2":null,"countryCode":"US","provinceCode":"CA"},"subtotalPriceSet":{"shopMoney":{"amount":"820.00"}},"displayFinancialStatus":"PAID","displayFulfillmentStatus":"UNFULFILLED"}'
)::jsonb, NOW() - INTERVAL '50 hours', '900098'),
(1, 'orders/fulfillment_updated', '{"status":"pending","order_id":"900098"}'::jsonb, NOW() - INTERVAL '50 hours', '900098:fulfillment_updated')
ON CONFLICT (shop_id, external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING;
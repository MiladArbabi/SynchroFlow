-- seed_incomplete_address_order.sql
-- OF-08 (2026-07-02): one order with a genuinely incomplete shipping
-- address, seeded through the real orders/sync event path (same
-- pattern as seed_watch_test_order.sql) — NOT a direct table write,
-- so aggregate_version/domain_events stay in sync and
-- EVENT_ANCHOR_INVARIANT never fires. Exists specifically to visually
-- verify the new ShippingAddressForm (customer/incomplete_address
-- resolution path) against a real order, not fabricated state.
-- Reuses the same variant as seed_watch_test_order.sql
-- (7ea4ee28-fbe6-bfd1-a60a-04c88f2f697b / APP-82994-8018) so no new
-- product data is needed.
-- shippingAddress deliberately omits address1/city/zip/countryCode —
-- matches evaluateCustomerConstraint's exact definition of "incomplete".
INSERT INTO domain_events (shop_id, event_type, event_payload, event_time, external_event_id)
VALUES
(1, 'orders/paid', '{"id":"900097"}'::jsonb, NOW() - INTERVAL '3 hours', '900097:paid'),
(1, 'orders/sync', (
  '{"id":"900097","name":"#2097","customer":{"id":"gid://shopify/Customer/27125114274162"},"createdAt":"' ||
  to_char(NOW() - INTERVAL '4 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
  '","lineItems":{"edges":[{"node":{"id":"gid://shopify/LineItem/900097001","product":{"id":"gid://shopify/Product/14838669082994"},"variant":{"id":"gid://shopify/ProductVariant/60837614748018"},"quantity":1,"originalTotalSet":{"shopMoney":{"amount":"820.00"}},"originalUnitPriceSet":{"shopMoney":{"amount":"820.00"}},"discountedUnitPriceSet":{"shopMoney":{"amount":"820.00"}}}}]},"updatedAt":"' ||
  to_char(NOW() - INTERVAL '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
  '","sourceName":"web","processedAt":"' ||
  to_char(NOW() - INTERVAL '4 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
  '","totalTaxSet":{"shopMoney":{"amount":"0.0"}},"currencyCode":"USD","totalPriceSet":{"shopMoney":{"amount":"820.00","currencyCode":"USD"}},"shippingAddress":{"zip":null,"city":null,"name":"Incomplete Address Test Customer","phone":null,"address1":null,"address2":null,"countryCode":null,"provinceCode":null},"subtotalPriceSet":{"shopMoney":{"amount":"820.00"}},"displayFinancialStatus":"PAID","displayFulfillmentStatus":"UNFULFILLED"}'
)::jsonb, NOW() - INTERVAL '4 hours', '900097'),
(1, 'orders/fulfillment_updated', '{"status":"pending","order_id":"900097"}'::jsonb, NOW() - INTERVAL '4 hours', '900097:fulfillment_updated')
ON CONFLICT (shop_id, external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING;
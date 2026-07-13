-- seed_overview_products.sql — local companion to seed_overview.sql
-- Creates the 13 products + 14 variants + identity-map rows that the
-- 9000xx order events reference. Required on LOCAL docker because the
-- event seed assumes prod Shopify products were already synced.
-- Idempotent: ON CONFLICT guards. unit_cost = 52% of price (realistic
-- margin); variant 60837614911858 kept at 0 to trigger missing_cogs.
-- NOTE: external_product_id / external_variant_id store FULL Shopify GIDs
-- (gid://shopify/...) because orders.create normalizes the line-item
-- variant to a full GID before the identity lookup (orders.create.ts:421).
BEGIN;
SET LOCAL "app.current_tenant" = '1';
SET LOCAL "synchroflow.projection" = 'true';

INSERT INTO products (lasyncro_product_id, shop_id, sku, title, status, product_type) VALUES
  ('4f0b6868-79d5-646c-5379-9b637ddfc33d',1,'APP-88082','Product 88082','active','physical'),
  ('8c99ded9-87c8-1a99-39d3-bdba6b592b64',1,'HOM-53618','Product 53618','active','physical'),
  ('b9b6610f-80be-7a8d-d661-473063af45d7',1,'ACC-86386','Product 86386','active','physical'),
  ('29817237-1882-f273-d88b-c81c14e27f1e',1,'KIT-84690','Product 84690','active','physical'),
  ('8e6c364e-f600-1a07-0b49-2be5f6c195bf',1,'OUT-17458','Product 17458','active','physical'),
  ('36e72f34-7346-727e-b5e1-5574c3f5398a',1,'TEC-50226','Product 50226','active','physical'),
  ('21b76c5c-ab4f-3890-9e7a-5752dec27300',1,'APP-82994','Product 82994','active','physical'),
  ('5bce5712-e4f0-3c9e-3770-98b347bb971a',1,'HOM-15762','Product 15762','active','physical'),
  ('7dbacad5-a05b-26d1-3824-d535f52314f6',1,'ACC-48530','Product 48530','active','physical'),
  ('b9510a46-88c8-0b72-9aa8-abfb7f979b55',1,'KIT-81298','Product 81298','active','physical'),
  ('1e3e3d70-e9b3-aad5-00f3-b06dc02a18cb',1,'OUT-14066','Product 14066','active','physical'),
  ('46bfc080-f962-4e11-4859-8739b8d736fb',1,'TEC-46834','Product 46834','active','physical'),
  ('0f846955-ded9-d5d1-9d59-bf479197e57b',1,'APP-79602','Product 79602','active','physical')
ON CONFLICT (shop_id, sku) DO NOTHING;

INSERT INTO variants (lasyncro_variant_id, lasyncro_product_id, shop_id, sku, title, barcode, unit_cost, status) VALUES
  ('9ce05d1d-ee19-cfa5-9dcd-a7040928ccda','4f0b6868-79d5-646c-5379-9b637ddfc33d',1,'APP-88082-1858','Variant 1858','BC4911858',0.00,'active'),
  ('5dca39bf-74c6-70eb-08d1-a4cb4604952d','8c99ded9-87c8-1a99-39d3-bdba6b592b64',1,'HOM-53618-5250','Variant 5250','BC4715250',127.40,'active'),
  ('443850fb-1aec-f297-95d1-3162dc38d2e5','b9b6610f-80be-7a8d-d661-473063af45d7',1,'ACC-86386-2306','Variant 2306','BC5272306',213.20,'active'),
  ('6f12576c-54f3-f2f4-88fb-dc31720e26b7','29817237-1882-f273-d88b-c81c14e27f1e',1,'KIT-84690-5074','Variant 5074','BC5305074',156.00,'active'),
  ('f0ff9579-b29f-7434-3f63-fed4c9d825fe','8e6c364e-f600-1a07-0b49-2be5f6c195bf',1,'OUT-17458-2930','Variant 2930','BC5042930',23.40,'active'),
  ('ad93ba56-fc8b-407a-9ed5-4844cbe89b00','36e72f34-7346-727e-b5e1-5574c3f5398a',1,'TEC-50226-5698','Variant 5698','BC5075698',166.40,'active'),
  ('7ea4ee28-fbe6-bfd1-a60a-04c88f2f697b','21b76c5c-ab4f-3890-9e7a-5752dec27300',1,'APP-82994-8018','Variant 8018','BC4748018',426.40,'active'),
  ('42a5b986-ec3c-b94a-4cde-546b2eb2e2e0','5bce5712-e4f0-3c9e-3770-98b347bb971a',1,'HOM-15762-8466','Variant 8466','BC5108466',28.60,'active'),
  ('b08871c4-ddb6-bbcf-aa01-ec1206a65a97','5bce5712-e4f0-3c9e-3770-98b347bb971a',1,'ACC-15762-6770','Variant 6770','BC5206770',28.60,'active'),
  ('e9574afd-9b2e-2a35-6376-d45591358b54','7dbacad5-a05b-26d1-3824-d535f52314f6',1,'KIT-48530-8914','Variant 8914','BC5468914',171.60,'active'),
  ('e584aeb1-3348-a134-4e3c-407972257190','b9510a46-88c8-0b72-9aa8-abfb7f979b55',1,'OUT-81298-1682','Variant 1682','BC5501682',145.60,'active'),
  ('4a2bf011-88dc-c9bb-9fb1-fa90007401e2','1e3e3d70-e9b3-aad5-00f3-b06dc02a18cb',1,'TEC-14066-7218','Variant 7218','BC5567218',358.80,'active'),
  ('45b3c077-f9c3-2da1-1ac7-612589bcbc54','46bfc080-f962-4e11-4859-8739b8d736fb',1,'APP-46834-4450','Variant 4450','BC5534450',249.60,'active'),
  ('2b1e6dd5-1077-c023-53e8-98d0dba72bf1','0f846955-ded9-d5d1-9d59-bf479197e57b',1,'HOM-79602-2754','Variant 2754','BC5632754',135.20,'active')
ON CONFLICT (shop_id, sku) DO NOTHING;

-- Deterministic floor stock exercises every map overlay against 30-unit pick bins.
INSERT INTO inventory_truth (
  shop_id,
  lasyncro_variant_id,
  location_code,
  on_hand_quantity,
  reserved_quantity,
  committed_quantity,
  available_quantity,
  sellable_quantity,
  last_evaluated_at
) VALUES
  (1, '9ce05d1d-ee19-cfa5-9dcd-a7040928ccda', 'A-1',  2, 0, 0,  2,  2, CURRENT_TIMESTAMP),
  (1, '5dca39bf-74c6-70eb-08d1-a4cb4604952d', 'A-2',  8, 0, 0,  8,  8, CURRENT_TIMESTAMP),
  (1, '443850fb-1aec-f297-95d1-3162dc38d2e5', 'A-3', 18, 0, 0, 18, 18, CURRENT_TIMESTAMP),
  (1, '6f12576c-54f3-f2f4-88fb-dc31720e26b7', 'A-4', 28, 0, 0, 28, 28, CURRENT_TIMESTAMP),
  (1, 'f0ff9579-b29f-7434-3f63-fed4c9d825fe', 'B-1',  3, 0, 0,  3,  3, CURRENT_TIMESTAMP),
  (1, 'ad93ba56-fc8b-407a-9ed5-4844cbe89b00', 'B-2', 12, 0, 0, 12, 12, CURRENT_TIMESTAMP),
  (1, '7ea4ee28-fbe6-bfd1-a60a-04c88f2f697b', 'B-3', 20, 0, 0, 20, 20, CURRENT_TIMESTAMP),
  (1, '42a5b986-ec3c-b94a-4cde-546b2eb2e2e0', 'B-4', 29, 0, 0, 29, 29, CURRENT_TIMESTAMP),
  (1, 'b08871c4-ddb6-bbcf-aa01-ec1206a65a97', 'C-1',  5, 0, 0,  5,  5, CURRENT_TIMESTAMP),
  (1, 'e9574afd-9b2e-2a35-6376-d45591358b54', 'C-2', 16, 0, 0, 16, 16, CURRENT_TIMESTAMP),
  (1, 'e584aeb1-3348-a134-4e3c-407972257190', 'C-3', 24, 0, 0, 24, 24, CURRENT_TIMESTAMP),
  (1, '4a2bf011-88dc-c9bb-9fb1-fa90007401e2', 'C-4', 30, 0, 0, 30, 30, CURRENT_TIMESTAMP),
  (1, '45b3c077-f9c3-2da1-1ac7-612589bcbc54', 'A-1',  1, 0, 0,  1,  1, CURRENT_TIMESTAMP),
  (1, '2b1e6dd5-1077-c023-53e8-98d0dba72bf1', 'A-2',  1, 0, 0,  1,  1, CURRENT_TIMESTAMP)
ON CONFLICT (shop_id, lasyncro_variant_id, location_code) DO UPDATE SET
  on_hand_quantity   = EXCLUDED.on_hand_quantity,
  reserved_quantity  = EXCLUDED.reserved_quantity,
  committed_quantity = EXCLUDED.committed_quantity,
  available_quantity = EXCLUDED.available_quantity,
  sellable_quantity  = EXCLUDED.sellable_quantity,
  last_evaluated_at  = EXCLUDED.last_evaluated_at,
  updated_at         = CURRENT_TIMESTAMP;

INSERT INTO external_product_identity_map (id, lasyncro_variant_id, shop_id, platform, external_product_id, external_variant_id, external_inventory_item_id, external_sku) VALUES
  ('4efe88e5-e3d9-0569-c55e-a385b8baf6dc','9ce05d1d-ee19-cfa5-9dcd-a7040928ccda',1,'shopify','gid://shopify/Product/14838668788082','gid://shopify/ProductVariant/60837614911858','INV4911858','APP-88082-1858'),
  ('91c9ee6f-d076-7c75-bf99-f50609d3fad4','5dca39bf-74c6-70eb-08d1-a4cb4604952d',1,'shopify','gid://shopify/Product/14838668853618','gid://shopify/ProductVariant/60837614715250','INV4715250','HOM-53618-5250'),
  ('6de0012c-f50e-bdb1-46d4-33a3efd018f9','443850fb-1aec-f297-95d1-3162dc38d2e5',1,'shopify','gid://shopify/Product/14838668886386','gid://shopify/ProductVariant/60837615272306','INV5272306','ACC-86386-2306'),
  ('b7cbc2ed-bfc7-b225-777b-b043f4e09008','6f12576c-54f3-f2f4-88fb-dc31720e26b7',1,'shopify','gid://shopify/Product/14838668984690','gid://shopify/ProductVariant/60837615305074','INV5305074','KIT-84690-5074'),
  ('f32d698a-4b73-dc01-50de-1093a506b1ba','f0ff9579-b29f-7434-3f63-fed4c9d825fe',1,'shopify','gid://shopify/Product/14838669017458','gid://shopify/ProductVariant/60837615042930','INV5042930','OUT-17458-2930'),
  ('5add7793-d752-59fe-1a96-481f9d6ad1b3','ad93ba56-fc8b-407a-9ed5-4844cbe89b00',1,'shopify','gid://shopify/Product/14838669050226','gid://shopify/ProductVariant/60837615075698','INV5075698','TEC-50226-5698'),
  ('e37458b6-fe5e-b505-b98b-65aed4172662','7ea4ee28-fbe6-bfd1-a60a-04c88f2f697b',1,'shopify','gid://shopify/Product/14838669082994','gid://shopify/ProductVariant/60837614748018','INV4748018','APP-82994-8018'),
  ('58b195c5-6c2c-2a1f-7934-9bcb1643e122','42a5b986-ec3c-b94a-4cde-546b2eb2e2e0',1,'shopify','gid://shopify/Product/14838669115762','gid://shopify/ProductVariant/60837615108466','INV5108466','HOM-15762-8466'),
  ('cb19a81a-f032-2ac7-0a0a-4e2a039ecef4','b08871c4-ddb6-bbcf-aa01-ec1206a65a97',1,'shopify','gid://shopify/Product/14838669115762','gid://shopify/ProductVariant/60837615206770','INV5206770','ACC-15762-6770'),
  ('823726ec-23d3-e56c-fa25-5bf22e710d1c','e9574afd-9b2e-2a35-6376-d45591358b54',1,'shopify','gid://shopify/Product/14838669148530','gid://shopify/ProductVariant/60837615468914','INV5468914','KIT-48530-8914'),
  ('93b482e5-ac67-a700-ebe3-1735f9c6852e','e584aeb1-3348-a134-4e3c-407972257190',1,'shopify','gid://shopify/Product/14838669181298','gid://shopify/ProductVariant/60837615501682','INV5501682','OUT-81298-1682'),
  ('5649e752-10b4-8dfc-d385-c9713b689d58','4a2bf011-88dc-c9bb-9fb1-fa90007401e2',1,'shopify','gid://shopify/Product/14838669214066','gid://shopify/ProductVariant/60837615567218','INV5567218','TEC-14066-7218'),
  ('876b4f64-2812-dbb4-690b-35e5fc284547','45b3c077-f9c3-2da1-1ac7-612589bcbc54',1,'shopify','gid://shopify/Product/14838669246834','gid://shopify/ProductVariant/60837615534450','INV5534450','APP-46834-4450'),
  ('08028c0c-c448-cba0-6242-a63b51f39e66','2b1e6dd5-1077-c023-53e8-98d0dba72bf1',1,'shopify','gid://shopify/Product/14838669279602','gid://shopify/ProductVariant/60837615632754','INV5632754','HOM-79602-2754')
ON CONFLICT (shop_id, platform, external_product_id, external_variant_id) DO NOTHING;

COMMIT;
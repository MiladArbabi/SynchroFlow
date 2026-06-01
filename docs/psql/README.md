# LaSyncro – PostgreSQL Operational Playbook

This document is the **single source of truth** for inspecting, verifying, and safely manipulating
SynchroFlow’s database state during development, debugging, and production support.

⚠️ **Hard rule:**  
We never reset the database to debug behavior.  
We only manipulate **integration state**, never canonical data.

---

## 0. Connecting to the Database

Always connect explicitly. Never rely on socket defaults.

```bash
PGPASSWORD=sf_pass psql \
  -h localhost \
  -p 5432 \
  -U sf_user \
  -d synchroflow_db
````

To run a single command without entering `psql`:

```bash
PGPASSWORD=sf_pass psql \
  -h localhost \
  -p 5432 \
  -U sf_user \
  -d synchroflow_db \
  -c "SELECT 1;"
```

rabbitMQ bash terminal
```bash
docker exec -it synchroflow_mq bash
```
---

## 1. Core Mental Model (Read This First)

### The system has **four layers of truth**:

1. **Integrations** → platform connection & sync lifecycle
2. **Canonical data** → orders, products, line items (idempotent)
3. **Insights** → first insight latch
4. **FT0 state** → activation milestone (write-once)

We **never** delete canonical data to “start over”.
We **only** re-run integrations.

---

## 2. Shopify Integration State

### Inspect Shopify integration

```sql
SELECT
  id,
  shop_id,
  platform,
  platform_shop_name,
  sync_status,
  sync_progress_current,
  sync_progress_total,
  sync_last_error,
  created_at
FROM integrations
WHERE platform = 'shopify'
ORDER BY created_at DESC;
```

### Integration states you should expect

| sync_status | Meaning                               |
| ----------- | ------------------------------------- |
| PENDING     | Connected but not synced              |
| SYNCING_*   | Active sync                           |
| COMPLETED   | Sync finished successfully            |
| FAILED      | Sync failed (check `sync_last_error`) |

---

## 3. Canonical Data Verification (Idempotency Proof)

### Canonical orders

```sql
SELECT COUNT(*) FROM canonical_orders;
```

### Canonical line items

```sql
SELECT COUNT(*) FROM canonical_order_line_items;
```

### Ensure no duplication (must always be empty)

```sql
SELECT canonical_order_id, COUNT(*)
FROM canonical_orders
GROUP BY canonical_order_id
HAVING COUNT(*) > 1;
```

```sql
SELECT canonical_line_item_id, COUNT(*)
FROM canonical_order_line_items
GROUP BY canonical_line_item_id
HAVING COUNT(*) > 1;
```

If these ever return rows → **system invariant is broken**.

---

## 4. First Insight Verification

### Check first insight latch

```sql
SELECT
  first_insight_delivered,
  orders_per_month_segment
FROM users
WHERE shop_id = 1;
```

Expected:

* `first_insight_delivered = true`
* `orders_per_month_segment IS NOT NULL`

This latch is **write-once**.

---

## 5. FT0 Activation State (Authoritative)

### Check FT0 state

```sql
SELECT
  status,
  completed_at
FROM ft0_state
WHERE shop_id = 1;
```

Expected:

* Exactly **one row**
* `status = COMPLETED`
* `completed_at IS NOT NULL`

⚠️ FT0 is **idempotent** and **never re-written**.

---

## 6. Activation Audit Trail (Forensics Only)

```sql
SELECT
  event_type,
  verdict,
  occurred_at,
  payload
FROM activation_audit_events
WHERE shop_id = 1
ORDER BY occurred_at DESC;
```

Audit events:

* May be noisy
* Are **non-authoritative**
* Must never block core logic

---

## 7. Safe Ways to Simulate “From Scratch”

### ❌ Never do this

* `DROP DATABASE`
* `dev:full`
* Re-running seeds to “test onboarding”

This invalidates all conclusions.

---

### ✅ Option A – Soft Reset (Sync replay)

Simulates: *Connected but not synced yet*

```sql
UPDATE integrations
SET
  sync_status = 'PENDING',
  sync_last_error = NULL,
  sync_progress_current = 0,
  sync_progress_total = 0
WHERE shop_id = 1
  AND platform = 'shopify';
```

Then trigger sync via API or UI.

---

### ✅ Option B – Logical Uninstall (Recommended)

Simulates real Shopify re-install.

```sql
DELETE FROM integrations
WHERE shop_id = 10
  AND platform = 'shopify';
```

Optional UI reset:

```sql
UPDATE users
SET shopify_connected = false
WHERE shop_id = 10;
```

Then:

* UI shows “Connect Shopify”
* OAuth runs again
* New integration row created
* Canonical data remains intact
* FT0 remains completed

This is **production-realistic**.

---

### ✅ Option C – Full Shopify Uninstall/Reinstall (Gold standard)

1. Uninstall app from Shopify admin
2. Shopify sends `app/uninstalled` webhook
3. User reinstalls app via UI
4. OAuth + sync re-run

Use sparingly.

---

## 8. Queue & Worker Verification

### Check integration sync result

```sql
SELECT
  id,
  sync_status,
  sync_last_error
FROM integrations
WHERE id = 1;
```

Expected:

* `sync_status = COMPLETED`
* `sync_last_error IS NULL`

If this is true, the worker path succeeded.

---

## 9. Invariants (Never Break These)

* Canonical tables are **append-idempotent**
* FT0 is **write-once**
* First insight is **write-once**
* Sync is **replayable**
* Integrations are **replaceable**

If you need to reset data to test → something upstream is wrong.

---

## 10. Final Rule

> If deleting an integration and re-connecting Shopify breaks anything,
> the system is not production-ready.

This playbook exists to ensure that never happens.

```
---

## X. Dev Barcode Seeding — WMS Scan Testing

### Context
Variants seeded directly into the `variants` table (not via Shopify sync pipeline) have no rows
in `external_product_identity_map` — the barcode resolver (`POST /api/v1/wms/barcode/resolve`)
will return null for any barcode scan against these variants.

Before any WMS pick/stow UI simulation on a fresh DB, seed barcodes for the relevant variants.

### Step 1 — Resolve current variant IDs (UUIDs change on every DB reset)

````sql
SET app.current_tenant = '1';
SELECT v.lasyncro_variant_id, v.sku
FROM variants v
WHERE v.shop_id = 1
AND v.sku IN ('TOTE-BLK','WOOL-BLK','WOOL-GRN','LINEN-GRY-M','LINEN-GRY-L','LINEN-GRY-S','LINEN-NVY-L')
ORDER BY v.sku;
````

### Step 2 — Insert identity map rows with barcode = SKU

````sql
SET app.current_tenant = '1';
INSERT INTO external_product_identity_map
  (id, shop_id, lasyncro_variant_id, platform, external_product_id, external_variant_id, external_sku, barcode)
VALUES
  (gen_random_uuid(), 1, '<TOTE-BLK-UUID>',    'shopify', 'dev-product-tote',  'dev-variant-tote-blk',   'TOTE-BLK',    'TOTE-BLK'),
  (gen_random_uuid(), 1, '<WOOL-BLK-UUID>',    'shopify', 'dev-product-wool',  'dev-variant-wool-blk',   'WOOL-BLK',    'WOOL-BLK'),
  (gen_random_uuid(), 1, '<WOOL-GRN-UUID>',    'shopify', 'dev-product-wool',  'dev-variant-wool-grn',   'WOOL-GRN',    'WOOL-GRN'),
  (gen_random_uuid(), 1, '<LINEN-GRY-M-UUID>', 'shopify', 'dev-product-linen', 'dev-variant-linen-grym', 'LINEN-GRY-M', 'LINEN-GRY-M'),
  (gen_random_uuid(), 1, '<LINEN-GRY-L-UUID>', 'shopify', 'dev-product-linen', 'dev-variant-linen-gryl', 'LINEN-GRY-L', 'LINEN-GRY-L'),
  (gen_random_uuid(), 1, '<LINEN-GRY-S-UUID>', 'shopify', 'dev-product-linen', 'dev-variant-linen-grys', 'LINEN-GRY-S', 'LINEN-GRY-S'),
  (gen_random_uuid(), 1, '<LINEN-NVY-L-UUID>', 'shopify', 'dev-product-linen', 'dev-variant-linen-nvyl', 'LINEN-NVY-L', 'LINEN-NVY-L')
ON CONFLICT DO NOTHING;
````

### Critical rules
- `external_variant_id` MUST be unique per `(shop_id, platform, external_product_id, external_variant_id)`.
  Two variants from the same product (e.g. LINEN-GRY-M and LINEN-GRY-L) must use distinct `external_variant_id` values.
- Barcode resolver resolution order: `external_product_identity_map.barcode` → `external_product_identity_map.external_sku` → `barcode_print_jobs.barcode_value`
- UUIDs in `variants` change on every DB reset — always re-query Step 1 before inserting.
- `ON CONFLICT DO NOTHING` is safe — if the row exists the barcode is already seeded.

### Verify after seeding

````sql
SET app.current_tenant = '1';
SELECT epim.lasyncro_variant_id, epim.barcode, v.sku
FROM external_product_identity_map epim
JOIN variants v ON v.lasyncro_variant_id = epim.lasyncro_variant_id
WHERE v.shop_id = 1 AND v.sku IS NOT NULL
ORDER BY v.sku;
````

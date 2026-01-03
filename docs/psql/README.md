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
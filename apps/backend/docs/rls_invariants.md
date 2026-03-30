# RLS INVARIANTS — SYNCHROFLOW

## HARD RULES (NON-NEGOTIABLE)

### 1. EVERY TABLE MUST HAVE RLS

No exceptions.

If a table exists → it MUST include:

* ENABLE ROW LEVEL SECURITY
* FORCE ROW LEVEL SECURITY
* CREATE POLICY

---

### 2. DIRECT ENFORCEMENT ALWAYS WINS

If `shop_id` exists:

```sql
USING (shop_id = current_setting('app.current_tenant')::int)
```

NEVER use joins when direct column exists.

---

### 3. RELATIONAL ENFORCEMENT ONLY WHEN REQUIRED

If NO `shop_id`, enforce via ownership chain:

Example:

```sql
USING (
  order_id IN (
    SELECT lasyncro_order_id
    FROM orders
    WHERE shop_id = current_setting('app.current_tenant')::int
  )
)
```

---

### 4. MIGRATION = SOURCE OF TRUTH

If RLS is not in migration:
→ it does not exist

Manual DB fixes are invalid.

---

### 5. NO PARTIAL SECURITY

All of these must be true:

* base tables secured
* projections secured
* outbox secured
* snapshots secured

If one is missing → system is compromised.

---

### 6. NEVER INTRODUCE SHOP_ID LATE

Tenant anchor must be defined at table creation.

Post-hoc addition = migration drift + policy inconsistency.

---

## CHECK COMMAND

Run before every merge:

```bash
grep -L "ENABLE ROW LEVEL SECURITY" apps/backend/migrations/*.ts | grep -v ".d.ts"
```

Expected output:
→ EMPTY

---

## FAILURE MODE

If violated:

* cross-tenant reads become possible
* data leaks silently
* no runtime errors occur

This is a **silent catastrophic failure class**.

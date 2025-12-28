# Unit Testing Guidelines (Updated)

## 🎯 Core Principle (Non-Negotiable)

**Unit tests run against the real database schema.**
No fake columns. No imaginary tables. No partial inserts.

If the schema changes, tests must change.

---

## 🧠 Mental Model

There are **two valid unit-testing styles** in this codebase:

### 1️⃣ Schema-Backed Unit Tests (Preferred)

Used for:

* onboarding
* lifecycle / state machines
* FT0 / FT1 / activation logic
* anything involving persistence guarantees

**Characteristics**

* Uses real Knex + test DB
* Respects NOT NULL / FK constraints
* Uses seed helpers
* No `jest.mock('api-db')`

> FT0CompletionService is the reference implementation.

---

### 2️⃣ Mocked Unit Tests (Allowed, but limited)

Used for:

* pure computation
* formatting
* query composition
* defensive logic

Mocking **must** follow the factory pattern (see below).

---

## 📁 Directory Structure

```
tests/unit/
├── onboarding/        # Activation, FT0–FTn, lifecycle logic
├── api/               # Business services (non-lifecycle)
├── ui/                # React component tests
├── helpers/           # Seed + test utilities (REQUIRED)
└── README.md
```

---

Here’s a **clean, locked update** to `tests/README.md` that incorporates the **Aha / FT1 panel testing pattern** without diluting your existing doctrine.

I’m not rewriting the whole file — I’m **extending it surgically**, so it stays authoritative and coherent.

---

## ✨ Add this section to `tests/README.md`

### (Recommended placement: **after “Directory Structure” or after “UI tests”**)

---

## 🧭 FT1 / Aha Panel Contract Tests (LOCKED)

FT1 diagnostic surfaces (a.k.a. **Aha panels**) follow a **strict, test-enforced contract**.

These are **not normal UI components**. They are **decision surfaces**.

---

### 🎯 Aha Panel Contract (Non-Negotiable)

Every FT1 / Aha panel **must**:

1. Render **exactly one diagnostic message**
2. Render **at most one CTA**
3. Emit **exactly one semantic intent**
4. **Never**:

   * navigate
   * open drawers
   * mutate lifecycle
   * dispatch DOM events directly
5. Delegate *all* consequences to the host

If an Aha panel “does something” by itself, **FT1 is broken**.

---

### 🧪 Shared Test Helper (MANDATORY)

All Aha panels must be tested using the shared helper:

```
tests/unit/ui/helpers/assertAhaPanelIntent.ts
```

This helper **locks the contract** and prevents regressions.

---

### ✅ Required Test Pattern

```ts
assertAhaPanelIntent({
  ui,
  ctaLabel,
  expectedIntent,
});
```

**What this enforces**

* CTA exists when expected
* CTA is clickable
* CTA emits **exactly one intent**
* No routing or lifecycle leakage
* No silent failures

---

### 📌 Example (Order-Nexus)

```tsx
assertAhaPanelIntent({
  ui: (
    <OrdersModule
      ordersIngested={3}
      hasNegativeMarginOrder={false}
      missingCostCount={2}
    />
  ),
  ctaLabel: 'Complete cost setup',
  expectedIntent: {
    type: 'START_ONBOARDING',
    taskId: 'add-costs',
  },
});
```

If any of the following happens, the test **must fail**:

* CTA label changes silently
* CTA emits multiple events
* CTA navigates directly
* CTA opens checklist internally
* Intent shape changes

---

### 🧠 Why This Exists

Without this helper, teams tend to:

* “Just navigate here”
* “Just open the checklist”
* “Just add analytics here”
* “Just add one more CTA”

That leads to:

* Fragmented onboarding
* Inconsistent Aha behavior
* FT1 lifecycle leaks
* Impossible-to-debug UX flows

This helper **prevents all of that**.

### 🚨 Rule Going Forward (Tattoo This Too)

> **If an Aha panel is not tested with `assertAhaPanelIntent`, it is not compliant.**

---

## 🌱 Seeding Rules (CRITICAL)

### Never inline inserts in tests

❌ **Wrong**

```ts
await db('shops').insert({ ... });
```

✅ **Correct**

```ts
await seedShopAndUser({ shopId, userId });
await seedIntegration({ shopId, syncStatus: 'COMPLETED' });
await seedCanonicalOrder({ shopId });
await seedCanonicalProduct({ shopId });
```

### Why

* Schema changes once → helpers update once
* Tests stay readable
* DRY is enforced structurally, not by discipline

---

## 🧪 Canonical Data Rules

Canonical tables are **strict** by design.

### canonical_orders requires (minimum)

* shop_id
* canonical_order_id
* platform
* platform_order_id
* currency
* total_price
* subtotal_price
* total_tax
* order_created_at
* order_updated_at

### canonical_products

* **Primary key is `canonical_product_id` (integer)**
* There is **no `id` column**

❌ Never do:

```ts
.count('id')
```

✅ Always do:

```ts
.count('* as count')
```

---

## ✅ Correct Existence Checks

**Always count rows, never columns**

```ts
const { count } = await db('canonical_products')
  .where({ shop_id })
  .count('* as count')
  .first();
```

This is schema-proof.

---

## 🔁 Idempotency Testing Pattern

When testing idempotent services:

```ts
const first = await Service.evaluate(shopId);
const second = await Service.evaluate(shopId);

expect(first.completed).toBe(true);
expect(second.alreadyCompleted).toBe(true);

const rows = await db('state_table').where({ shop_id });
expect(rows.length).toBe(1);
```

Idempotency is **observable behavior**, not an implementation detail.

---

## 🧼 Cleanup Rules

Every schema-backed test **must** clean up in `beforeEach`:

```ts
await db('ft0_state').where({ shop_id }).del().catch(() => {});
await db('integrations').where({ shop_id }).del();
await db('canonical_orders').where({ shop_id }).del();
await db('canonical_products').where({ shop_id }).del();
await db('users').where({ id: userId }).del();
await db('shops').where({ id: shopId }).del();
```

No shared state. Ever.

---

## 🧪 Example: Gold-Standard Test File

Use this as the **template** going forward:

```
tests/unit/onboarding/ft0-completion.service.test.ts
```

If a new test doesn’t look like this structurally, it’s probably wrong.

---

## 🧯 Mocked DB Pattern (Only When Needed)

If mocking `api-db`, **factory pattern is mandatory**.

```ts
jest.mock('api-db', () => {
  const instance = {
    where: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
    first: jest.fn(),
  };

  const db = jest.fn(() => instance);
  (db as any).fn = { now: jest.fn(() => 'now') };

  return { __esModule: true, default: db };
});
```

If you see hoisting errors → you violated this rule.

---

## 🚨 What We Do NOT Do Anymore

* ❌ Mock DB for lifecycle logic
* ❌ Insert partial rows
* ❌ Guess column names
* ❌ Count non-existent `id` columns
* ❌ Repeat seed logic inline
* ❌ Let tests pass by accident

---

## 🧠 Final Rule (Tattoo This)

> **If a test passes without respecting the real schema, it is lying.**

FT0 is now:

* schema-correct
* idempotent
* deterministic
* future-proof

This README now reflects that reality.
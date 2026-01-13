# E2E Tests (Playwright)

This directory contains **end-to-end tests** for SynchroFlow using **Playwright**.

These tests are designed to **lock backend authority**, validate **real lifecycle behavior**, and prevent regressions caused by UI inference, auth shortcuts, or implicit state transitions.

---

## 🎯 Purpose of E2E Tests

E2E tests in this repo exist to verify **system contracts**, not UI cosmetics.

They are used to assert that:

- Backend lifecycle is **snapshot-driven**
- Lifecycle promotions are **explicit and idempotent**
- Auth tokens respect **identity invariants**
- FT transitions cannot be inferred or bypassed
- Real HTTP boundaries behave correctly

If a behavior is important enough to rely on in production, it must be enforceable here.

---

## 🧭 Test Types

### 1. **API-Only E2E Tests**
Located in:
```

tests/e2e/*.e2e.spec.ts

```

Characteristics:
- Do NOT open a browser
- Do NOT rely on UI routing
- Use authenticated API contexts
- Validate backend authority directly

Example:
- `lifecycle.e2e.spec.ts`

These are the **preferred** E2E tests.

---

### 2. **UI-Based E2E Tests (Use Sparingly)**

Allowed only when:
- The behavior cannot be verified via API
- You are testing routing, rendering, or user interaction
- You are NOT asserting business logic

UI tests must:
- Assume backend correctness
- Never infer lifecycle or permissions
- Never “fix” backend bugs via UI logic

---

## 🔐 Authentication Strategy (MANDATORY)

### ✅ Correct (Current Standard)

- Use **test-only token issuance**
- Authenticate once per test via API
- Pass `Authorization: Bearer <token>` explicitly

Used via:
```

tests/e2e/utils/api-auth.ts

```

This avoids:
- Cookie/session coupling
- UI login flakiness
- Cross-test state bleed

---

### ❌ Forbidden

Do NOT:
- Log in via the UI for backend tests
- Reuse browser storage state for API tests
- Bypass identity checks
- Stub auth middleware
- Hardcode JWTs

If auth is broken, **fix auth** — do not bypass it.

---

## 🧪 Database & Seed Expectations

E2E tests assume:

- Database is reset before runs
- `DEV_SEED_MODE=full_identity`
- Test user has:
  - User record
  - Shop record
  - Active shop membership

This is enforced via:
```

npm run test:setup

```

If a test fails due to missing identity, that is **correct behavior**.

---

## 🧱 Lifecycle Testing Rules (CRITICAL)

Lifecycle rules are **non-negotiable**:

- `/api/v1/lifecycle` is the ONLY read authority
- Confirm endpoints are the ONLY write authority
- Eligibility ≠ Promotion
- Promotion MUST be user-triggered
- Confirm endpoints MUST be idempotent

Tests MUST verify:
- Initial phase
- Transition
- Snapshot persistence
- Idempotency

If a lifecycle test passes without checking the snapshot, it is invalid.

---

## 🚫 Absolute Don’ts

Never:
- Infer lifecycle from readiness
- Infer lifecycle from entitlements
- Infer lifecycle from integration state
- Assert UI state instead of backend state
- Add retry loops that mutate state
- Add “temporary” test shortcuts

Temporary test hacks always become permanent production bugs.

---

## ⚙️ Playwright Config (As-Is)

**Current config highlights:**

- Test directory: `tests/e2e`
- API-only project enabled (`api`)
- Browser projects may exist but are optional
- Backend server is auto-started
- No implicit auth setup required for API tests

See:
```

playwright.config.ts

```

API tests should be runnable via:
```

NODE_ENV=test npm run test:e2e

```

---

## 🧠 Design Philosophy

E2E tests here exist to answer one question:

> “Can the system lie to itself?”

If the answer is ever “yes”, the test suite is incomplete.

---

## ✅ If You Add a Test

Before committing, ask:

- Does this enforce a real contract?
- Does it fail if the backend lies?
- Does it avoid UI inference?
- Will this catch future regressions?

If not — don’t add it.

---

## 🧨 Final Warning

E2E tests are **expensive but authoritative**.

A flaky E2E test is worse than no test.
A misleading E2E test is worse than a bug.

Treat this directory as **production infrastructure**, not a playground.
```

---
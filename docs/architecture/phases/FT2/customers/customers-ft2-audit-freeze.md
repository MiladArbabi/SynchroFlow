# 🔒 FT2 Customers / Specter Contract Audit (Updated)

**Status:** Sealed · Evidence-Backed · Code-Complete
**FT Level:** **FT2 is the terminal vertical** (no FT3, no escalation)
**Guarantee:** Every statement below is provable from code as-written.

---

## I. Canonical Scope Definition

### Audited Pipelines (End-to-End)

* **Customers FT2**

  ```
  customers-facts → customers-intelligence → customers-ftep → ft2 provider → adapter → UI
  ```
* **Specter FT2**

  ```
  specter-facts → specter-intelligence → specter-ftep → ft2 provider → adapter → UI
  ```
* **Cross-module consumption**

  * Customers UI consumes **Specter FT2 only**
  * Customers Facts are **not rendered**

### Explicitly Out of Scope

* FT1 behavior (documented only to prove isolation)
* Any lifecycle / onboarding / activation logic
* Any future, speculative, or “planned” fields
* OpsConsole (see Section VIII)

---

## II. Customers FT2 — Full Contract Ledger (As-Built)

> **Customers FT2 is intentionally truth-minimal.
> Structural capability exists, exposure does not.**

---

### A. Layer 1 — Customers Facts (Persistence → Extraction)

**Source**

```
apps/backend/src/services/customers-facts/customersFacts.service.ts
```

**Canonical Table**

* `customers`

**Extracted Fields**

| Field               | Type           | Semantics                        |
| ------------------- | -------------- | -------------------------------- |
| `shopId`            | number         | Authoritative                    |
| `period.from`       | ISO string     | Backend-enforced                 |
| `period.to`         | ISO string     | Backend-enforced                 |
| `customersObserved` | number | null  | `null` only if DB not observable |
| `activityObserved`  | boolean | null | Creation-as-activity proxy       |
| `extractedAt`       | ISO string     | Extraction timestamp             |

**Important Corrections vs Old Audit**

❌ Old claim: *“counts collapse to null if zero”*
✅ Reality: **zero is preserved**, not collapsed

```ts
customersObserved = 0 // valid, explicit absence
```

**Hard Truths**

* Customers Facts **do preserve zero**
* No semantic collapse happens at this layer
* Customer creation is the **sole activity proxy**
* No behavioral meaning is implied

---

### B. Layer 2 — Customers Intelligence (Pure Classification)

**Source**

```
apps/backend/src/services/customers-intelligence/customersIntelligence.service.ts
```

**Inputs**

* `customersObserved`

**Derived Fields**

| Field             | Values                 | Notes                         |
| ----------------- | ---------------------- | ----------------------------- |
| `outcome.status`  | `positive` | `unknown` | `negative` unreachable in FT2 |
| `trend.direction` | `unknown`              | Structural placeholder only   |

**Rules**

* `customersObserved === null` → `unknown`
* `customersObserved >= 0` → `positive`

**Hard Truths**

* Intelligence **never asserts absence**
* Negative state is **theoretically defined but unreachable**
* No continuity, no trend, no escalation

---

### C. Layer 3 — Customers FTEP (Truth Exposure Policy)

**Source**

```
apps/backend/src/services/customers-ftep/customersFtep.service.ts
```

**CTR Model**

| Condition                    | CTR   |
| ---------------------------- | ----- |
| `customersObserved === null` | CTR_0 |
| `customersObserved !== null` | CTR_1 |

**Exposure Behavior**

| Field                      | Exposure           |
| -------------------------- | ------------------ |
| `context.customersPresent` | gated by CTR       |
| `identityCoverage`         | always `'unknown'` |
| `activityObserved`         | gated by CTR       |
| `outcome`                  | **always null**    |
| `trend`                    | **always null**    |

**Hard Truths**

* Customers FT2 **never exposes intelligence**
* Outcome & trend are structurally present but **intentionally suppressed**
* This is not an omission — it is a lock

---

### D. Layer 4 — Customers FT2 Provider

**Source**

```
apps/backend/src/services/customers-ft2.provider.ts
```

**Behavior**

* Deterministic orchestration:

  ```
  Facts → FTEP
  ```
* Intelligence is computed but **not exposed**
* No enrichment
* No entitlement logic

---

### E. Customers Frontend Adapter

**Source**

```
apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts
```

**Observed Reality**

| Field                  | Status             |
| ---------------------- | ------------------ |
| Customers Facts        | ❌ not consumed     |
| Customers Intelligence | ❌ not consumed     |
| Customers FTEP output  | ❌ ignored entirely |

This is **intentional silence**, not a bug.

---

### F. Customers FT2 UI

**Source**

```
modules/customers/src/ui/pages/CustomersModuleFT2.tsx
```

**Rendered Reality**

| Category               | Rendered |
| ---------------------- | -------- |
| Customers Facts        | ❌        |
| Customers Intelligence | ❌        |
| Customers FTEP         | ❌        |

**Net Result**

> Customers FT2 currently renders **zero customer-derived truth**.
> All visible signals come from **Specter FT2 only**.

---

## III. Specter FT2 — Full Contract Ledger

---

### A. Layer 1 — Specter Facts (Observed Reality)

**Source**

```
apps/backend/src/services/specter-facts/specterFacts.service.ts
```

**Domains Implemented (1–12)**

| Domain | Signal Type                 | Notes                   |
| ------ | --------------------------- | ----------------------- |
| 1      | Identity Presence           | Always `null`           |
| 2      | Activity Presence           | `sessionsPresent`       |
| 3      | Engagement Structure        | depth proxies           |
| 4      | Surface Breadth             | existence-only          |
| 5      | Returning Behavior          | existence-only          |
| 6      | Exit Without Interaction    | compound                |
| 7      | Funnels / Journey Structure | existence-only          |
| 8      | Exit Intent                 | existence-only          |
| 10     | Instrumentation Gaps        | meta-observability      |
| 11     | Data Freshness              | extraction vs window    |
| 12     | Cross-Domain Consistency    | contradiction detection |

**Critical Properties**

* All signals are **existence-only**
* All degrade cleanly to `null`
* No ratios, no counts, no inference

---

### B. Layer 2 — Specter Intelligence

**Source**

```
apps/backend/src/services/specter-intelligence/specterIntelligence.service.ts
```

**Derived Fields**

| Field                | Values                              |
| -------------------- | ----------------------------------- |
| `engagement.status`  | `positive` | `negative` | `unknown` |
| `behavior.direction` | `unknown`                           |
| `behavior.trend`     | `unknown`                           |

**Consumption Rules**

* Intelligence uses **only structural presence**
* Does **not** consume:

  * `exitWithoutInteractionPresent`
  * `instrumentationGaps`
  * `dataFreshness`
  * `consistencyIssues`

These remain **Facts-only truth**.

---

### C. Layer 3 — Specter FTEP

**Source**

```
apps/backend/src/services/specter-ftep/specterFtep.service.ts
```

**CTR Model**

| Condition                  | CTR   |
| -------------------------- | ----- |
| `sessionsPresent !== true` | CTR_0 |
| `sessionsPresent === true` | CTR_1 |

**Exposed Signals**

* Activity presence
* Engagement status
* All structural signals (Domains 3–8)
* Instrumentation gaps (Domain 10)
* Data coverage
* Direction (always null)

**Downgrade Rules**

* CTR < 1 → **everything null**
* No partial exposure
* No shadow leakage

---

### D. Layer 4 — Specter FT2 Provider

**Source**

```
apps/backend/src/services/specter-ft2.provider.ts
```

**Behavior**

* Deterministic
* No filtering
* No reshaping
* No interpretation

---

### E. Customers Consumption of Specter FT2

**Adapter**

```
useCustomersFt2Adapter.ts
```

**UI**

```
CustomersModuleFT2.tsx
```

**Rendered Surfaces (9)**

1. Activity observed
2. Activity direction (always neutral)
3. Multi-step sessions
4. Surface breadth
5. Returning sessions
6. Exit without interaction
7. Average session depth
8. Exit intent
9. Funnels
10. Data coverage
11. Instrumentation gaps *(render-ready but not yet surfaced)*

**Hard Rule**

> UI renders **only what FTEP explicitly exposes**.

---

## IV. Global FT2 Integrity Assertions (Provable)

1. No FT2 surface invents data
2. No intelligence leaks without FTEP approval
3. No domain infers beyond existence
4. `null` always originates upstream
5. Specter and Customers are strictly isolated
6. Instrumentation gaps describe **our eyesight**, not user behavior
7. Consistency issues detect contradictions, not errors
8. **FT2 is terminal — no escalation path exists**

---

## V. OpsConsole — Explicit Non-Existence

* OpsConsole has:

  * ❌ no Facts
  * ❌ no Intelligence
  * ❌ no FTEP
  * ❌ no Provider
* Any OpsConsole surface would require a **new contract**

Until then, OpsConsole is **out of scope by definition**.

---

## 🔐 Final Seal Statement (Reaffirmed)

This document represents the **complete, implementation-faithful FT2 contract** for Customers and Specter.

Nothing exists unless observed.
Nothing is implied.
Nothing escalates.
Nothing lives beyond FT2.

**FT2 is sealed.**

---
# FT1 Foundation — Contract & Rules

## 1️⃣ What FT1 *is* (non-negotiable)

**FT1 = “Data is real, meaning is shallow.”**

FT1 answers only:

* *Is data present?*
* *Is it complete enough to render?*
* *What is the current observable state?*

FT1 does **NOT**:

* Optimize
* Predict
* Recommend
* Infer causes
* Tell stories

If logic feels “smart”, it does **not** belong in FT1.

---

## 2️⃣ Single Source of Truth (SSOT)

| Layer             | Responsibility                          |
| ----------------- | --------------------------------------- |
| Database          | Ground truth (counts, existence)        |
| Backend providers | Compute **facts**, never interpretation |
| Readiness service | Aggregate signals, no coercion          |
| FT1 adapters      | **Pure mapping only**                   |
| Scenario hooks    | Minimal state classification            |
| UI                | Display, nothing more                   |

No layer may “fix” another layer’s data.

---

## 3️⃣ FT1 Signal Rules (CRITICAL)

### 🔒 Rule 1: `null` vs `0` is sacred

| Value  | Meaning                            |
| ------ | ---------------------------------- |
| `null` | Unknown / not ready / not computed |
| `0`    | Known zero (real result)           |

❌ **Never** default unknown numbers to `0`
❌ **Never** infer readiness from falsy values

This rule alone caused the Orders bug.

---

### 🔒 Rule 2: Backend must declare *knowledge*

Every FT1 module **must emit an explicit “known” signal**.

Example:

```ts
orderNexus.ordersKnown = true
```

This prevents UI logic from guessing.

If a query ran → it is *known*
If not → it must be `null` or absent

---

## 4️⃣ FT1 Adapter Contract (Frontend)

**FT1 adapters must be:**

* Pure functions
* No hooks
* No lifecycle logic
* No loading logic
* No fallbacks

✅ Allowed:

```ts
Number(signal ?? null)
```

❌ Forbidden:

```ts
Number(signal ?? 0)
signal || 0
signal ? value : 0
```

Adapters map. They never decide.

---

## 5️⃣ FT1 Scenario Rules

Scenarios are **mechanical**, not semantic.

Example (Orders):

```ts
null  → LOADING
0     → NO_DATA
>0    → DATA_PRESENT
```

Scenarios must:

* Be deterministic
* Depend only on mapped props
* Never call APIs
* Never inspect readiness directly

---

## 6️⃣ FT1 UI Rules

FT1 UI may only say:

* “Loading…”
* “No data yet”
* “Data present”
* “Incomplete data”

FT1 UI must **not**:

* Suggest action quality
* Blame the user
* Offer optimization advice

That belongs to FT2+.

---

## 7️⃣ FT1 Exit Criteria (Module-Level)

A module is **FT1-complete** when:

* [ ] DB truth verified
* [ ] Provider emits `XKnown = true`
* [ ] Adapter preserves `null`
* [ ] Scenario test passes
* [ ] UI state matches reality

No FT2 work may start before this checklist is green.

---

## 8️⃣ Enforcement Rule (Team Rule)

> If a bug can be fixed by “just defaulting to 0”,
> **you are violating FT1**.

Stop and fix the contract instead.

---

### ✅ Why this matters

You didn’t have an Orders bug.
You had a **missing FT1 contract**.

Now you don’t.

---

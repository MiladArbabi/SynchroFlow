# FT2 Customers Doctrine

**Canonical v1 — Locked**

## 1. Purpose (Why Customers FT2 Exists)

Customers FT2 exists to **reveal the economic truth of a business’s customer base**.

It answers one question only:

> **“Is this business built on economically healthy customers — or fragile foundations?”**

FT2 is not assistance.
FT2 is not advice.
FT2 is not optimization.

FT2 exposes truth.

---

## 2. Scope (What Customers FT2 Is Allowed to Do)

Customers FT2 is a **read-only, deterministic synthesis layer**.

It:

* aggregates **orders + financial truth**
* exposes **structural customer reality**
* highlights **dominant weaknesses**
* surfaces **time-based stability or decay**

Customers FT2 does **not**:

* recommend actions
* score customers
* guide optimization
* hide discomfort
* soften conclusions

---

## 3. Data Ownership Rules (Non-Negotiable)

### Customers FT2 MAY use data from:

* Orders FT2
* Finances FT2
* Canonical customer/order aggregates
* Time-based comparisons

### Customers FT2 MAY NOT:

* fetch data directly
* infer missing data
* compute heuristics in the UI
* override nulls
* collapse uncertainty

### Specter relationship (critical)

* Specter **never defines customer truth**
* Specter signals may only:

  * influence **confidence**
  * explain **volatility**
* Specter is **context**, never headline

If Specter appears as a primary source → **architecture violation**.

---

## 4. Canonical FT2 Customers Offerings (v1)

These are the **only allowed offerings**.

### A. Customer Value Structure (Required)

Economic truth, grounded in orders.

Must include:

* Active customers
* Repeat rate (%)
* Average order value
* Lifetime value (nullable)
* Currency

Rules:

* No estimates
* No projections
* No “potential value”
* If unknown → `null`

---

### B. Customer Quality Signal (Required)

Exactly **one** dominant weakness, or `null`.

Allowed types:

* `low_repeat`
* `low_value`
* `high_churn`
* `concentration`
* `unknown`

Must include:

* confidence: `high | medium | low`

Rules:

* No multiple weaknesses
* No scoring
* No ranking
* No recommendations

FT2 reveals the **weakest link**, not a checklist.

---

### C. Time / Stability Signal (Required)

Trend over time, not performance judgment.

Allowed values:

* `improving`
* `deteriorating`
* `stable`
* `volatile`
* `unknown`

Optional:

* Compared period window

Rules:

* No growth language
* No targets
* No celebration
* Only directionality

---

### D. Concentration & Dependency Risk (Required if detectable)

Expose fragility that growth can hide.

Examples:

* Revenue concentrated in few customers
* Repeat dependency skew
* Uneven customer value distribution

Rules:

* Nullable
* Confidence-tagged
* No mitigation advice

If the business is fragile, FT2 must show it.

---

## 5. Presentation Rules (UI Discipline)

Customers FT2 UI must be:

* Deterministic
* Static
* Read-only
* Uncomfortable when truth is weak

### Allowed UI elements

* Tables
* Lists
* Trend labels
* Confidence tags
* Placeholders (`—`)

### Forbidden UI elements

* Buttons
* CTAs
* “Fix”, “Improve”, “Optimize”
* “You should…”
* Tooltips that advise
* Scoring systems

FT2 does not help the user cope.
It helps them **see**.

---

## 6. Architectural Enforcement

Customers FT2 must follow:

```
Backend Snapshot
      ↓
Pure Adapter
      ↓
FT2 Props (null-safe, explicit)
      ↓
CustomersModuleFT2 (render only)
```

Violations include:

* lifecycle logic in module
* fetching in module
* defaulting missing values
* casting (`as any`)
* bypassing adapter

If violated, FT2 is broken.

---

## 7. Semantic Separation (Hard Rule)

* **Customers** = customer truth
* **Specter** = behavioral telemetry engine

Specter:

* may exist in backend
* may exist in adapters
* may exist in docs

Specter:

* must not define Customers FT2
* must not appear as customer-facing truth

If naming or imports blur this line → fix immediately.

---

## 8. Definition of Done (Customers FT2)

Customers FT2 is complete when:

* Truth is exposed without interpretation
* Nulls are preserved
* Weaknesses are visible
* Confidence is explicit
* No advice is present
* No Specter UI leakage exists

If the user feels uneasy reading FT2:

> it’s working.

---

## 9. Final Principle (Memorize This)

> **FT2 does not persuade.
> FT2 does not assist.
> FT2 reveals structural truth — and leaves the response to the human.**

---
Below is the **fully populated cross-surface alignment matrix**, followed by a **detailed, field-level matrix**.
Everything here is derived **only** from scanned code. No inference.

---

## 1️⃣ Cross-Surface Alignment Matrix (Authoritative)

| Module    | Fact Exists | Intelligence Active | FTEP Exposes        | FT2 Provider Emits | Adapter Consumes | UI Shows |
| --------- | ----------- | ------------------- | ------------------- | ------------------ | ---------------- | -------- |
| Customers | ✅ Yes       | ✅ Yes (binary)      | ⚠️ Outcome nullable | ✅ Yes              | ⚠️ Partial       | `—`      |
| Specter   | ✅ Yes       | ✅ Yes               | ⚠️ Outcome nullable | ✅ Yes              | ❌ No             | ❌ No     |

**Legend**

* ⚠️ = present but conditionally nulled
* ❌ = not consumed / not wired
* `—` = explicit null rendering

---

## 2️⃣ Customers — Detailed Field Alignment Matrix

### Context / Facts

| Field               | Facts | Intelligence | FTEP | FT2 Provider | Adapter         | UI |
| ------------------- | ----- | ------------ | ---- | ------------ | --------------- | -- |
| `period.from`       | ✅     | —            | ✅    | ✅            | ⚠️ default `''` | ✅  |
| `period.to`         | ✅     | —            | ✅    | ✅            | ⚠️ default `''` | ✅  |
| `customersObserved` | ✅     | —            | ✅    | ✅            | ❌               | ❌  |

⚠️ **Observed:**

* Backend exposes `customersObserved`
* Frontend adapter **does not map it**
* UI never sees it

---

### Intelligence → Outcome

| Field            | Intelligence | FTEP                   | FT2 Provider | Adapter | UI |
| ---------------- | ------------ | ---------------------- | ------------ | ------- | -- |
| `outcome.status` | ✅            | ⚠️ nulled if `unknown` | ✅            | ❌       | ❌  |

⚠️ **Observed:**

* Intelligence exists
* Exposure intentionally suppresses when unknown
* Adapter does not consume outcome at all

---

### Intelligence → Trend

| Field             | Intelligence        | FTEP      | FT2 Provider | Adapter | UI |
| ----------------- | ------------------- | --------- | ------------ | ------- | -- |
| `trend.direction` | ⚠️ always `unknown` | ⚠️ nulled | ✅            | ❌       | ❌  |

⚠️ **Observed:**

* Trend is structurally present but **static**
* FTEP nulls it with outcome
* UI has no access path

---

## 3️⃣ Adapter-Only Fields (No Backend Source)

| Field                      | Backend Source | Adapter   | UI  |
| -------------------------- | -------------- | --------- | --- |
| `context.sessionsObserved` | ❌ none         | ✅ expects | `—` |
| `systemState`              | ❌ none         | ✅ expects | `—` |
| `timeSignal`               | ❌ none         | ✅ expects | `—` |

**Observed Truth**

* These fields are **never produced** by:

  * Customers Facts
  * Customers Intelligence
  * Customers FTEP
  * Customers FT2 Provider
* Adapter correctly normalizes them to `null`
* UI correctly renders `—`

---

## 4️⃣ Specter — FT2 Alignment (Customers Context)

| Layer             | Field                            | Status   |
| ----------------- | -------------------------------- | -------- |
| Facts             | `sessionsObserved`               | ✅ exists |
| Intelligence      | `engagement`, `behavior`         | ✅ exists |
| FTEP              | `outcome`, `signals`, `coverage` | ✅ exists |
| FT2 Provider      | emits snapshot                   | ✅        |
| Customers Adapter | consumes                         | ❌        |
| Customers FT2 UI  | renders                          | ❌        |

**Observed Truth**

* Specter FT2 pipeline is complete
* Customers FT2 **does not consume Specter FT2**
* No cross-module leakage

---

## 5️⃣ Final Integrity Statement (Provable)

From scans alone, the following are **true**:

* No facts are invented
* No intelligence leaks
* All nulls are intentional and enforced
* UI rendering of `—` is honest
* Shape mismatches are **passive**, not compensatory
* FT2 Customers currently exposes **context only**, no outcomes

---

# 🔒 LaSyncro — Canonical Tasklist & SLA Framework

**Applies to:** Founders · Engineering · Product · Release
**Purpose:** Ensure inevitability through discipline

---

## 1. MASTER TASKLIST (BY PHASE)

### **PHASE 0 — FOUNDATION LOCK (Months 0–3)**

**Objective:** Truth-complete core, zero users.

**Tasks**

* [ ] Canonical data ingestion from Shopify (Orders only)
* [ ] Orders Facts layer complete (null-safe)
* [ ] Orders Intelligence layer (internal-only)
* [ ] Orders FTEP implemented & tested
* [ ] Trust / Data Health Facts + FTEP
* [ ] RO-Overview rendering (Orders + Trust only)
* [ ] Forbidden-language linting in UI
* [ ] Snapshot regression tests
* [ ] Rollback mechanism in place

**Exit Gate**

* ❌ No interpretation questions internally
* ❌ No crashes on empty data
* ❌ No UI copy explaining meaning

---

### **PHASE 1 — SILENT ALPHA (Months 4–6)**

**Objective:** Validate epistemic discomfort.

**Tasks**

* [ ] Customers Facts implemented
* [ ] Customers Intelligence (classification only)
* [ ] Customers FTEP downgrade rules
* [ ] Customers FT2 UI (null-explicit)
* [ ] Invite-only access control
* [ ] Passive logging of confusion points
* [ ] Zero feature requests accepted

**Exit Gate**

* ≥70% of users ask “is this bad?”
* ≥30% ask “what should I do?”
  *(Both are success signals)*

---

### **PHASE 2 — PAID BLINDNESS REMOVAL (Months 7–12)**

**Objective:** First paid conversions.

**Tasks**

* [ ] Products / SKU-OS FT2 (end-to-end)
* [ ] Inventory FT2 (presence + coherence)
* [ ] Returns & Exceptions submodule
* [ ] Paid plan enforcement (history, coverage)
* [ ] Alignment Planes (core only)
* [ ] Billing (simple, no discounts)

**Exit Gate**

* ≥3% free → paid conversion
* Paid users spend longer in RO-Overview than Free

---

### **PHASE 3 — PHYSICAL REALITY (Months 13–18)**

**Objective:** Ground truth in the physical world.

**Tasks**

* [ ] WMS Lite PWA (scan, receive, pick, pack, ship)
* [ ] Offline queue + replay
* [ ] Event ingestion → Inventory coherence
* [ ] No KPIs, no metrics, no summaries

**Exit Gate**

* Inventory nulls reduced
* No WMS user asks for “performance stats”

---

### **PHASE 4 — FINANCIAL REALITY (Months 19–24)**

**Objective:** Remove cash illusion.

**Tasks**

* [ ] Finance Facts (payments, payouts, refunds)
* [ ] Finance FTEP downgrade
* [ ] Finance ↔ Orders / Returns alignment
* [ ] Finance FT2 UI (presence-only)

**Exit Gate**

* ≥90% finance signals have freshness metadata
* Users explicitly mention “revenue ≠ cash”

---

### **PHASE 5 — CNS COMPLETION (Months 25–36)**

**Objective:** Structural inevitability.

**Tasks**

* [ ] SKU Integrity / Deviation submodule
* [ ] Full Alignment Plane set
* [ ] Historical depth maximized
* [ ] Long-term stability hardening

**Exit Gate**

* Feature pressure drops
* Users describe LaSyncro as “infrastructure”

---

## 2. SLA — DELIVERY & DISCIPLINE

### **2.1 Release SLA**

| Rule              | SLA                   |
| ----------------- | --------------------- |
| Release unit      | Whole FT2 module only |
| Partial surfaces  | ❌ Forbidden           |
| Release frequency | Max 1 per quarter     |
| UI semantics      | Zero explanations     |
| Rollback          | Same-day capability   |

---

### **2.2 Truth Integrity SLA**

| Check                  | Requirement   |
| ---------------------- | ------------- |
| Null handling          | 100% explicit |
| Coverage shown         | Always        |
| Intelligence leakage   | 0 tolerance   |
| Alignment before trust | ❌ Forbidden   |

Violation → **Immediate rollback**

---

### **2.3 Cash & Runway SLA**

| Metric                | Threshold      |
| --------------------- | -------------- |
| Monthly burn variance | ≤ ±10%         |
| Infra growth          | ≤ 20% QoQ      |
| Runway < 12 months    | Freeze roadmap |
| Runway < 9 months     | Bug-fix only   |

---

### **2.4 Decision SLA**

| Question                  | Rule                         |
| ------------------------- | ---------------------------- |
| “Can we add this?”        | No, unless blindness reduced |
| “Will this help users?”   | Irrelevant                   |
| “Does this explain?”      | Immediate reject             |
| “Does this hide absence?” | Immediate reject             |

---

## 3. MONTHLY GOVERNANCE CHECK (MANDATORY)

Every month, answer **YES / NO only**:

1. Did we expose any meaning?
2. Did we hide any nulls?
3. Did we ship under cash pressure?
4. Did we promise future capability?
5. Did we optimize for conversion over truth?

**Any YES → roadmap freeze + correction**

---

## 🔐 FINAL EXECUTION LAW (SEALED)

> **Progress is not measured by features shipped.
> It is measured by lies avoided.**

This tasklist + SLA is **the roadmap**.
If followed, LaSyncro reaches inevitability.
If bent, it becomes ordinary.
# 🔒 WMS‑Lite FT2 — Canonical Blueprint (System of Action)

**Module:** WMS‑Lite
**Phase:** FT2 (Terminal, Action-Bound)
**Status:** Canonical · Locked · Consortium‑Sealed
**Entitlement:** Paid‑Only
**Audience:** Architecture · Operations · Trust

---

## 0. Prime Intent (Read Carefully)

WMS‑Lite is **not** a traditional WMS.
It is **not** an optimization engine.
It is **not** a planning or forecasting system.

WMS‑Lite exists for one reason only:

> **To allow humans to execute physical warehouse actions when FT2 truth makes those actions epistemically safe.**

It is a **System of Action**, deliberately separated from Systems of Truth.

---

## 1. Foundational Constraint (Non‑Negotiable)

WMS‑Lite:

* ❌ does **not** generate truth
* ❌ does **not** infer state
* ❌ does **not** override FT2 reality

It may only:

* receive **permissioned FT2 truth**
* expose **explicit, bounded actions**
* record **action execution events**

If truth is unclear, **action is disallowed**.

---

## 2. Relationship to FT2 (Critical Separation)

WMS‑Lite sits **beside** FT2 — never above it.

```
FT2 Modules (Orders · Inventory · Shipping · Trust)
        ↓ (read‑only)
   Action Eligibility Gate
        ↓
     WMS‑Lite Actions
        ↓
  Action Execution Events
        ↓
 (persisted, never interpreted)
```

WMS‑Lite **consumes truth**.
FT2 **never consumes actions**.

---

## 3. Allowed Action Domains (LOCKED)

WMS‑Lite actions are limited to **physical warehouse verbs**.

### Canonical Action Set

1. **Receive**
   *Mark inbound goods as physically received*

2. **Store (Put‑Away)**
   *Assign received goods to a physical location*

3. **Pick**
   *Acknowledge physical picking of items*

4. **Pack**
   *Confirm packing completion*

5. **Ship**
   *Confirm handoff to carrier*

No other verbs may exist.

---

## 4. Action Eligibility Gate (Mandatory)

Every action must pass an **eligibility check** before becoming executable.

### Inputs

* Inventory FT2
* Orders FT2
* Shipping FT2
* Trust / Data Health FT2

### Eligibility Rules (Illustrative)

* If `trustEligible = null` → ❌ no actions
* If inventory visibility = `null` → ❌ no pick
* If order fulfillment status = `null` → ❌ no pack

Eligibility logic is **binary**:

> Allowed / Not Allowed

No suggestions. No nudges.

---

## 5. Canonical Architecture (Action‑Bound)

WMS‑Lite intentionally **breaks the FT2 4‑layer pattern**.

```
Action Requests (UI)
   ↓
Eligibility Gate (read‑only FT2)
   ↓
Action Execution
   ↓
Action Event Log (Persistence)
```

There is:

* ❌ no Facts layer
* ❌ no Intelligence layer
* ❌ no FTEP

Because WMS‑Lite **does not speak truth**.

---

## 6. Action Execution Rules

When an action is executed:

* It is recorded verbatim
* It is timestamped
* It is immutable
* It carries **no semantic interpretation**

Action events are **historical facts**, not truth upgrades.

---

## 7. UI Contract (Mobile‑First)

WMS‑Lite UI:

* Mobile‑first
* Touch‑optimized
* Explicit action confirmation
* No background automation

UI must never:

* Auto‑execute
* Suggest next actions
* Highlight urgency
* Mask ineligibility

If an action is disallowed, the UI must say nothing.

---

## 8. Entitlement Law

WMS‑Lite is **paid‑only** because:

* It creates operational liability
* It enables physical execution
* It must not exist without trust

Free tier exposure is forbidden.

---

## 9. Explicit Non‑Capabilities (Sealed)

WMS‑Lite contains **no**:

* Wave planning
* Route optimization
* Slotting logic
* Labor optimization
* Automation rules
* AI decisioning

---

## 🔐 Final Seal

WMS‑Lite is a **disciplined bridge** between truth and action.

It acts **only when reality is clear**.

If truth is silent, WMS‑Lite must also be silent.

This blueprint is **canonical and locked**.
Any expansion requires explicit consortium RFC.
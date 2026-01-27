# 🔒 InfoBlock — FT2 Narrative Primitive (CANONICAL PLAYBOOK v2.0)

**Status:** ✅ SEALED / CANONICAL
**Applies to:** All FT2 modules (Orders, Revenue, Returns, Operations, Future)
**Apex Rule:** **FT2 is the terminal truth layer. InfoBlock wraps FT2; it never alters it.**

This document supersedes all previous InfoBlock guidance.

---

## 0. Executive Definition (Read This First)

> **An InfoBlock is a narrative wrapper around downgraded truth that allows SMBs to orient themselves in under 5 seconds without being told what to think or what to do.**

If an InfoBlock:

* explains,
* persuades,
* prioritizes,
* diagnoses,
* recommends,

…it is **invalid**.

---

## 1. Why InfoBlock Exists (Revalidated)

FT2 surfaces (`FT2Surface`) are **structural primitives**, not cognitive ones.
They expose truth correctly but **at the wrong resolution for human scanning**.

**InfoBlock exists to solve exactly one problem:**

> **Reduce cognitive load without increasing semantic load.**

### What this means in practice

InfoBlock:

* reduces *mental parsing cost*
* preserves *epistemic humility*
* exposes *business nouns*, not system mechanics
* hides complexity **without lying**

---

## 2. What InfoBlock IS / IS NOT (Clarified)

### ✅ InfoBlock IS

* A **narrative grouping primitive**
* A **read-only FT2 wrapper**
* A **scan-optimized orientation surface**
* A **UI-only construct**
* A **business-noun carrier** (orders, revenue, returns, etc.)

### ❌ InfoBlock IS NOT

* a data source
* a logic container
* a calculator
* an analytics surface
* an intelligence layer
* a recommendation system
* a workflow launcher
* a diagnostics panel

> **InfoBlock may arrange truth.
> It may never transform truth.**

---

## 3. Architectural Position (Hard-Locked)

```
Canonical Facts
   ↓
Intelligence (internal only)
   ↓
FTEP (Truth Downgrade Policy)
   ↓
FT2 Snapshot (terminal truth)
   ↓
Adapters (pure pipes)
   ↓
InfoBlock (narrative wrapper)
   ↓
Human perception
```

### Non-negotiable invariants

* InfoBlock **never bypasses FT2**
* InfoBlock **never feeds upstream**
* InfoBlock **never sees intelligence**
* InfoBlock **never performs logic**

---

## 4. InfoBlock Contract (API — Final)

### 4.1 `InfoBlock`

```ts
export interface InfoBlockProps {
  title: string;          // Narrative label only
  children: ReactNode;    // Rows + optional footer
}
```

**Rules**

* `title` is copy-only
* No icons
* No badges
* No dynamic formatting
* No truncation logic
* No interactivity

---

### 4.2 `InfoBlockRow`

```ts
export interface InfoBlockRowProps {
  label: string;                   // Domain name (business noun)
  value: string | number | null;   // FT2-exposed fact
  diff?: string | null;            // Optional secondary column
}
```

**Rendering Rules**

* `value === null` → render `—`
* `diff === undefined` → column hidden
* `diff === null` → render `—`

**Prohibited**

* colors conveying meaning
* arrows, icons, emojis
* derived values
* percentages unless canonical
* conditionals
* thresholds

**Semantic Rules**

* One row = **one domain**
* One row answers **one factual question**
* Rows are **stable across all states**

---

### 4.3 `InfoBlockFooter` (Interpretation Rail)

```ts
export interface InfoBlockFooterProps {
  line1: string;
  line2?: string;
}
```

**Hard Limits**

* Max 2 lines
* Each line ≤ 5–10 words
* Declarative only
* Uppercase only

**The footer:**

* does **not explain**
* does **not justify**
* does **not guide**

> It orients attention, nothing more.

---

## 5. Interpretation Rail (IR) — Hard Boundary

The footer is **FT2-adjacent**, not FT2.

### ✅ Allowed

* Epistemic scope
  (“ORDER OBLIGATIONS ARE VISIBLE”)

* Visibility constraints
  (“EXECUTION STATES SHOWN ELSEWHERE”)

* Availability disclaimers
  (“RETURN DATA PARTIALLY AVAILABLE”)

### ❌ Forbidden

* “You should…”
* “This means…”
* “Likely because…”
* “Improve by…”
* “Risky / Good / Bad”
* Any causal language
* Any urgency framing

**Rule of thumb:**

> If removing the footer would change a decision, the footer is invalid.

---

## 6. Typography & Visual Contract (Enforced)

### 6.1 Typeface

**IBM Plex Mono — mandatory**

**Why**

* Equal glyph width
* No implied hierarchy
* Neutral tone
* Optimized for scanning, not persuasion

---

### 6.2 Capitalization

* **ALL TEXT UPPERCASE**
* Enforced at container level
* Never manually capitalized in copy

**Why**

* Removes emphasis hacks
* Equalizes labels, values, and absence
* Makes `—` visually honest

---

### 6.3 Layout Invariants

* Fixed width: **350px**
* Height: content-driven
* Rows: single-line only
* Columns: `LABEL | VALUE | DIFF`
* Numbers right-aligned
* No wrapping
* Footer always visible

---

## 7. Density Rules

**Default density:** `compact`

**Why**

* SMB scan patterns
* Prevents dashboard bloat
* Forces domain discipline

No per-module overrides allowed.

---

## 8. Domain & Row Selection Rules (Critical)

Every InfoBlock must satisfy **all** of the following.

### 8.1 Finite Rows

* Typically **3–5 rows**
* Never scroll internally
* If more rows are needed → wrong InfoBlock

---

### 8.2 No Redundancy

* If two rows answer the same question → one must go
* Redundancy is a cognitive tax

---

### 8.3 Presence Over Precision

Priority order:

1. Presence
2. Magnitude
3. Comparison

Never skip presence to show precision.

---

### 8.4 Stability

* Rows **never appear/disappear**
* Missing data renders as `—`
* Structural stability > informational completeness

---

## 9. Business-Noun Rule (New, Mandatory)

All InfoBlock rows must be phrased as **business nouns**, not system states.

### ✅ Good

* Orders total
* Fulfilled orders
* Returned items
* Revenue pending settlement

### ❌ Forbidden

* Ingestion status
* Sync health
* Pipeline latency
* Data freshness (as a row)

System realities may exist:

* in FT2
* in gating
* in trust logic
* in IR copy

They must **not** dominate the InfoBlock.

---

## 10. Obligation vs Execution Rule (New, Critical)

Every InfoBlock must be classified as **one of the following**:

### A. Obligation InfoBlock

Answers:

> “What obligations exist?”

Examples:

* Orders Overview
* Returns Overview
* Revenue Overview

These **must not** include execution stages.

---

### B. Execution State InfoBlock (FT2-Paid / Actions-Adjacent)

Answers:

> “Where are obligations right now?”

Examples:

* Picking / Packing / Shipping states
* Warehouse stages

These:

* must be separate InfoBlocks
* must be explicitly capability-gated
* must never leak into obligation blocks

---

## 11. Orders Overview — Reference Implementation (Sealed)

**Title:** `ORDERS OVERVIEW`

**Rows (immutable):**

1. Orders total
2. Fulfilled orders
3. Unfulfilled orders
4. Incoming orders

**Semantic guarantees**

* Presence-based
* Time-agnostic (except incoming)
* No urgency
* No SLA
* No diagnosis

**Footer (locked):**

* `ORDER OBLIGATIONS ARE VISIBLE`
* `EXECUTION STATES SHOWN ELSEWHERE`

This block is the **reference standard**.

---

## 12. Adapter & Wiring Rules (Reinforced)

* Adapters are **pipes, not brains**
* Allowed operation: `undefined → null`
* No computation
* No defaults
* No guards in UI

If something crashes:

* fix the wiring
* do not soften the UI

---

## 13. What Engineers May NOT Do (Expanded)

* Add logic to InfoBlock
* Compute values inside rows
* Fix data issues in UI
* Add conditional styling
* Add icons or colors
* Reorder rows dynamically
* Add tooltips
* Add click handlers
* Turn InfoBlock into a “card”
* Hide bad data

Violations are **architecture breaches**, not styling bugs.

---

## 14. Replication Rule (Project-Wide)

Any FT2 module that wants to:

* summarize truth
* reduce cognitive load
* present multiple domains

**must use InfoBlock**.

No custom summary components. Ever.

---

## 15. Final Seal (v2.0)

* InfoBlock is the **primary FT2 narrative primitive**
* Business nouns carry truth, not system mechanics
* Obligation and execution are structurally separated
* Trust is enforced by wiring, not UX tricks
* SMB cognition is respected **without manipulation**

🔐 **This playbook is sealed, canonical, and mandatory.**

---
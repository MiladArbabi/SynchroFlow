# 🔒 InfoBlock — FT2 Narrative Primitive

**Status:** ✅ SEALED / CANONICAL
**Applies to:** All FT2 modules (Orders, Revenue, Returns, Future)
**Apex Rule:** **FT2 remains the truth layer. InfoBlock wraps FT2, never alters it.**

---

## 0. Why InfoBlock Exists (Non-Negotiable Rationale)

FT2 surfaces (`FT2Surface`) are **structural primitives**.
They are **too low-level** for SMB cognition when exposed directly.

**InfoBlock exists to solve exactly one problem:**

> **Reduce cognitive load without increasing semantic load.**

InfoBlock:

* groups related FT2 facts,
* preserves observational truth,
* introduces *controlled narrative order*,
* **without** introducing interpretation, advice, or intelligence.

---

## 1. What InfoBlock IS (Precisely)

**InfoBlock is:**

* A **semantic grouping primitive**
* A **read-only FT2 wrapper**
* A **scan-optimized narrative container**
* A **UI-only construct**

**InfoBlock is NOT:**

* ❌ a data source
* ❌ a logic container
* ❌ a calculator
* ❌ an analytics surface
* ❌ an intelligence layer
* ❌ a recommendation system

> **InfoBlock may arrange truth.
> It may never transform truth.**

---

## 2. InfoBlock Position in the Architecture (Locked)

```
Facts → Intelligence → FTEP → FT2 Snapshot
                                   ↓
                          FT2 Surfaces (structural)
                                   ↓
                         InfoBlock (narrative wrapper)
                                   ↓
                           Human perception
```

**Critical invariant:**

> InfoBlock sits **after FT2**.
> It never bypasses FT2.
> It never feeds anything upstream.

---

## 3. InfoBlock Contract (API)

### 3.1 `InfoBlock`

```ts
export interface InfoBlockProps {
  title: string;          // Narrative label only
  children: ReactNode;    // Rows + optional footer
}
```

**Rules**

* `title` is **copy-only**
* No icons
* No status indicators
* No dynamic formatting
* No truncation logic

---

### 3.2 `InfoBlockRow`

```ts
export interface InfoBlockRowProps {
  label: string;                   // Domain name
  value: string | number | null;   // FT2-exposed fact
  diff?: string | null;            // Optional comparative text
}
```

**Rules**

* `value === null` → render `—`
* `diff === undefined` → column hidden
* `diff === null` → render `—`
* No colors convey meaning
* No arrows, icons, emojis
* No derived values
* No percentage math
* No conditionals

**Row semantics**

* One row = **one domain**
* A row answers **one factual question**
* Rows must be stable across renders

---

### 3.3 `InfoBlockFooter` (Interpretation Rail — FT2-Adjacent)

```ts
export interface InfoBlockFooterProps {
  line1: string;
  line2?: string;
}
```

**Rules**

* Copy-only
* Max **2 lines**
* Each line **≤ 5–10 words**
* Declarative tone only
* No verbs implying action
* No causality
* No advice
* No recommendations
* No emotional language

> The footer **explains nothing**.
> It **orients attention**.

---

## 4. Interpretation Rail (IR) — Hard Boundary

The footer is an **FT2-adjacent layer**, not FT2 itself.

### Allowed

* Clarifying epistemic state
  (“Fulfillment counts unavailable”)
* Restating visibility constraints
  (“Order flow is visible”)
* Declaring scope
  (“Revenue pending fulfillment”)

### Forbidden

* ❌ “You should…”
* ❌ “This means…”
* ❌ “Likely because…”
* ❌ “Improve by…”
* ❌ “Risky / Good / Bad”
* ❌ Any causal framing

If IR copy **changes decisions**, it is invalid.

---

## 5. Typography & Visual Contract (Locked)

### 5.1 Typeface

**IBM Plex Mono — mandatory**

Reason:

* Equal glyph width
* Neutral tone
* Prevents visual hierarchy hacks
* Encourages scanning, not persuasion

No other fonts allowed inside InfoBlock.

---

### 5.2 Capitalization

* **ALL TEXT UPPERCASE**
* Enforced at container level (`text-transform`)
* Never manually capitalized in copy

Reason:

* Eliminates emphasis games
* Equalizes labels, values, and absence

---

### 5.3 Layout Invariants

* Fixed width: **350px**
* Height: **content-driven**
* Rows: **single-line only**
* Columns: `LABEL | VALUE | DIFF`
* Numbers right-aligned
* Text never wraps inside rows
* Footer always visible (no clipping)

---

## 6. Density Rules

**Default density:** `compact`

Why:

* SMB scanning behavior
* Prevents dashboard sprawl
* Forces discipline in row selection

Future densities may exist, but:

* **compact is the default**
* No per-module overrides allowed

---

## 7. Row Selection Rules (Critical)

### Every InfoBlock must obey:

1. **Finite rows**

   * Typically 3–5
   * Never scroll internally

2. **No redundancy**

   * If two rows answer the same question → one is removed

3. **Presence over precision**

   * Presence beats magnitude
   * Magnitude beats comparison

4. **Stability**

   * Rows must not appear/disappear across states
   * Missing data renders as `—`, not removed

---

## 8. Orders InfoBlock v1.1 (Sealed Example)

**Title:** `ORDERS OVERVIEW`

**Rows (immutable):**

1. Orders total
2. Fulfilled orders
3. Unfulfilled orders
4. Incoming orders

**Footer (locked IR):**

* Line 1: `ORDER FLOW IS VISIBLE`
* Line 2: `FULFILLMENT COUNTS UNAVAILABLE`

This is now **reference behavior**.

---

## 9. What Engineers May NOT Do

* ❌ Add logic to InfoBlock
* ❌ Compute values inside rows
* ❌ Add conditional styling
* ❌ Add icons or colors for meaning
* ❌ Reorder rows dynamically
* ❌ Add tooltips
* ❌ Add click handlers
* ❌ Turn InfoBlock into a card widget

Violations are **architecture breaches**, not style issues.

---

## 10. Replication Rule (Project-Wide)

Any future FT2 module that wants to:

* summarize facts,
* reduce cognitive load,
* present multi-domain truth,

**must use InfoBlock**.

Custom summary components are **not allowed**.

---

## 11. Final Seal

* InfoBlock is now the **primary FT2 narrative primitive**
* FT2Surface remains **structural scaffolding**
* Interpretation Rail is **contained and controlled**
* Truth remains downgraded, observable, and neutral
* SMB cognition is respected **without manipulation**

🔐 **InfoBlock contract is sealed, canonical, and mandatory.**

---
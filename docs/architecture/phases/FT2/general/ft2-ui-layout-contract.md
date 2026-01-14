# FT2 UI Layout Contract (v1.0) — 🔒 LOCKED

**Status:** Sealed
**Applies to:** All FT2 modules (`modules/*`)
**Audience:** Module authors, reviewers, future maintainers
**Last validated:** OrdersModuleFT2

---

## 1. Purpose

FT2 layouts exist to render **facts, not narratives**.

The goal is to provide:

* Deterministic geometry
* Zero inference
* Stable visual grammar
* Predictable behavior across screen sizes
* No layout surprises under resize or data variance

FT2 is **not** a dashboard builder.
FT2 is a **fact surface grammar**.

---

## 2. Core Principles (Non-Negotiable)

1. **Semantic intent > pixel tweaking**
2. **Rows define geometry, not surfaces**
3. **Surfaces never size themselves**
4. **Charts must never escape their surface**
5. **Responsive behavior is explicit, not emergent**
6. **Modules compose, frontend mounts**

If a change violates any of the above, it is rejected.

---

## 3. Canonical Components

FT2 consists of exactly **three layout primitives**:

| Component    | Responsibility                        |
| ------------ | ------------------------------------- |
| `FT2Layout`  | Global container, padding, centering  |
| `FT2Row`     | Horizontal grammar (columns + height) |
| `FT2Surface` | Visual containment and affordances    |

No other layout primitives are allowed in FT2 modules.

---

## 4. `FT2Layout` Contract

### Responsibilities

* Constrain max width
* Apply **symmetric padding**
* Maintain predictable distance from viewport edges
* Stack rows vertically with deterministic gaps

### Rules

* Padding must be symmetric on **all sides**
* Layout starts at the **top**, never vertically centered
* Layout participates in full-height outlet

### Canonical Implementation

```tsx
<FT2Layout>
  {rows}
</FT2Layout>
```

### Invariants

* ❌ No per-module padding hacks
* ❌ No vertical centering by default
* ❌ No grid logic here

---

## 5. `FT2Row` Contract (The Grammar Core)

### Intent-Based Layout

Rows are declared **by intent**, not by numbers.

```ts
export type FT2RowIntent = 'kpi' | 'analysis' | 'support';
```

Each intent maps to **deterministic geometry** via tokens.

---

### Row Token Grammar (LOCKED)

```ts
row: {
  kpi: {
    columns: 6,
    height: 120,
  },
  analysis: {
    columns: 2,
    height: 280,
  },
  support: {
    columns: 3,
    height: 160,
  },
}
```

These values are **defaults**, not suggestions.

---

### Responsive Behavior (Mandatory)

| Breakpoint | Behavior                        |
| ---------- | ------------------------------- |
| `xs`       | Auto height, stacked            |
| `md+`      | Fixed row height, column layout |

Implementation rule:

```ts
height: {
  xs: 'auto',
  md: rowConfig.height,
}
```

---

### Grid Rules

* Row **must** be a Grid container
* Items **must** use `size`, not `item`
* Each cell:

  * `display: flex`
  * `minWidth: 0`
  * height fills row at `md+`

---

### Prohibited

* ❌ Passing raw column numbers from modules
* ❌ Inline `Grid` usage in FT2 modules
* ❌ Per-row pixel overrides

---

## 6. `FT2Surface` Contract

### Responsibility

A surface is a **hard visual container** with:

* Fixed control zone
* Flexible content zone
* Guaranteed clipping

Surfaces **do not decide size**.

---

### Structural Rules

1. Surface **must fill its grid cell**
2. Surface **must clip overflow**
3. Control zone height is fixed
4. Content zone flex-fills remaining height

---

### Required Styles (Non-Optional)

```ts
sx={{
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}}
```

Control zone:

```ts
flexShrink: 0
```

Content zone:

```ts
flex: 1
minHeight: 0
```

---

### Icons Rule (Locked)

* Only **kebab menu (⋮)** is visible by default
* No other icons may be rendered initially
* Expansion behavior (future) must be **explicitly triggered**

---

## 7. Charts & Visualizations (FT2-Safe)

### Mandatory Wrapper

All charts **must** be wrapped:

```tsx
<div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
  <Chart height="100%" />
</div>
```

### Absolute Rules

* ❌ Charts may NOT define their own width
* ❌ Charts may NOT overflow their surface
* ❌ Charts may NOT assume fixed pixel height

If a chart bleeds, the chart is wrong — not the layout.

---

## 8. Module Authoring Rules

### Allowed

```tsx
<FT2Row intent="kpi">
  <FT2Surface />
  <FT2Surface />
</FT2Row>
```

### Forbidden

* ❌ Custom Grid usage
* ❌ Inline flex hacks
* ❌ Width logic inside modules
* ❌ Layout conditionals
* ❌ Media queries in modules

Modules **declare intent only**.

---

## 9. What FT2 Explicitly Does NOT Do

FT2 does **not**:

* Infer importance
* Collapse empty surfaces
* Auto-reflow based on data
* Adapt semantics per module
* Animate layout

FT2 is **deterministic**.

---

## 10. Change Policy

Any change to:

* row intents
* token values
* responsive rules
* overflow behavior

Requires:

1. Updating this contract
2. Validating against **at least two modules**
3. Explicit approval

Otherwise: ❌ rejected.

---

## 11. Final Lock Statement

> **FT2 is a language, not a layout.
> Modules speak it.
> Tokens define it.
> Layout enforces it.**

This contract is **sealed**.

No silent deviations.
No “just this module” exceptions.
No pixel drift.

---
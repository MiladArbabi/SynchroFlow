# **LaSyncro UI — Design Tokens Contract (v1.0)**

### **Canonical Specification for Colors, Typography, Spacing, Radii & Shadows**

**Status:** Stable (FT0–FT1 locked)
**Scope:** All frontend UI, all modules (CNS Suite), dashboards, widgets, surfaces
**Purpose:** Provide a single source of truth for all design tokens used across LaSyncro.

---

# 1. **Overview**

Design tokens define the smallest, indivisible building blocks of LaSyncro's visual system:

* Colors
* Typography
* Spacing
* Borders & radii
* Shadows
* Motion
* Z-index layers

These tokens guarantee consistency across all modules and prevent one-off UI decisions that break the platform’s coherence.

**This contract supersedes any token definitions inside Berry Templates.**
Berry is *inspired by* our tokens — not the source of truth.

---

# 2. **Token Architecture Diagram**

```
tokens/
 ├── core/
 │     ├── color.json
 │     ├── typography.json
 │     ├── spacing.json
 │     ├── radii.json
 │     ├── shadows.json
 │     └── zindex.json
 ├── semantic/
 │     ├── surface.json
 │     ├── border.json
 │     ├── status.json
 │     └── interactive.json
 └── module-scopes/
       ├── specter.json
       ├── insight-core.json
       ├── order-nexus.json
       └── sku-os.json
```

---

# 3. **Core Tokens**

## 3.1 Colors (Atomic Layer)

These are raw color primitives — generated from `presetColorId`, but *never overridden by modules*.

### **Primary**

```
primary.light
primary.main
primary.dark
primary.200
primary.800
```

### **Secondary**

```
secondary.light
secondary.main
secondary.dark
secondary.200
secondary.800
```

### **Greyscale**

```
grey.50
grey.100
grey.200
grey.300
grey.500
grey.600
grey.700
grey.900
```

### **Feedback Colors**

```
error.light / main / dark
warning.light / main / dark
success.light / main / dark
orange.light / main / dark
```

### **Dark Mode Extensions**

```
dark.main
dark.level1
dark.level2
dark.background
dark.paper
```

---

# 4. **Semantic Tokens (Aligned With Merchant Modes)**

Semantic tokens define *meaning*, not raw color values.

## 4.1 Surface Tokens

```
surface.default          → background.default
surface.paper             → background.paper
surface.sunken            → dark.level1
surface.raised            → dark.level2 (or shadow elevation 1)
```

## 4.2 Border Tokens

```
border.default           → grey.200
border.strong            → grey.300
border.subtle            → grey.100
```

## 4.3 Status Tokens (Cross-module Consistent)

```
status.info      → primary.main
status.warning   → warning.main
status.critical  → error.main
status.success   → success.main
status.neutral   → grey.500
```

## 4.4 Interactive Tokens

```
interactive.hover
interactive.active
interactive.selected
interactive.disabled
interactive.disabled-bg
```

Derived using consistent alpha rules.

---

# 5. Typography Tokens

### Families

```
font.family.primary
font.family.mono
```

### Sizes

```
font.size.xs
font.size.sm
font.size.md
font.size.lg
font.size.xl
font.size.display
```

### Weights

```
font.weight.regular
font.weight.medium
font.weight.bold
```

### Line-heights

```
line-height.tight
line-height.normal
line-height.loose
```

---

# 6. Spacing Tokens

Universal spacing scale:

```
0  
4     (xs)
8     (sm)
12
16    (md)
20
24    (lg)
32
40
48     (xl)
64     (xxl)
```

Every module **must** use spacing tokens.
No pixel literals allowed except for layout primitives.

---

# 7. Radii Tokens

```
radius.none     → 0
radius.sm       → 4
radius.md       → 8
radius.lg       → 12
radius.round    → 100%
```

Modules cannot introduce custom radii.

---

# 8. Elevation & Shadows

```
shadow.0   → none
shadow.1   → subtle ambient
shadow.2   → card hover
shadow.3   → raised panel
shadow.4   → modal overlay
```

These map to Berry’s shadow definitions but are normalized.

---

# 9. Z-Index Tokens

```
z.base          → 0
z.header        → 1000
z.sidebar       → 1100
z.overlay       → 1200
z.modal         → 1300
z.toast         → 1400
z.ops-console   → 1500
```

This ensures Ops Console always floats above everything.

---

# 10. Token Contract Rules

## Rule 1 — **No module owns colors**

Modules only use semantic tokens.

## Rule 2 — **No inline CSS values**

All sizes, colors, and spacing must use tokens.

## Rule 3 — **Tokens are stable**

New tokens may be added, never removed.

## Rule 4 — **Modules may not modify theme**

Only global-level design system controls theme shape.

## Rule 5 — **Dark mode must be token-driven**

No hard-coded conditionals in component code.

---

# 11. Mapping Into MUI Theme (Canonical)

This ensures compatibility with:

* Berry overrides
* Custom components
* CNS widgets
* Module UIs

```
theme.palette.primary.main       = primary.main
theme.palette.grey[200]          = grey.200
theme.palette.background.default = surface.default
theme.shape.borderRadius         = radius.md
theme.spacing()                  = spacing tokens
theme.shadows[2]                 = shadow.2
```

---

# 12. Token Versioning

```
v1.0 → Locked for FT0–FT1  
v1.1 → Expansion for FT2 (Growth Intelligence)  
v2.0 → Full CNS Unified Redesign  
```

Reverse-compatibility required.

---

# 13. Appendix: Token Consumption Examples

## Example — Widget Shell

```
padding: spacing.md;
border-radius: radius.md;
background: surface.raised;
box-shadow: shadow.1;
```

## Example — Module Panel

```
border: 1px solid border.default;
background: surface.paper;
```

## Example — Interactive Component

```
:hover {
  background: interactive.hover;
}
```

---

# ✅ Document Completed

This document is now ready in final form and integrates cleanly with:

* Berry template
* LaSyncro’s theme system
* CNS module architecture
* Merchant Mode semantics
* Future CNS UI structure

---
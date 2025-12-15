# **03 — Design Tokens Contract (Normative, Enforced)**

**LaSyncro UI Platform — Canonical Design Token Specification**

**Status:** 🔐 Locked (FT0–FT1)
**Owner:** UI Platform Architecture
**Applies to:** All UI primitives, all modules, all layouts, all widgets

---

## 1. Purpose (Normative)

Design tokens are the **single source of truth** for all visual decisions in LaSyncro.

They define **what values exist**, **what they mean**, and **how they are consumed**.

No UI code may introduce visual values outside this contract.

---

## 2. Token Architecture (Authoritative)

```
tokens/
 ├── core/              # raw, non-semantic primitives
 ├── semantic/          # meaning-driven tokens
 └── module-scopes/     # strictly controlled extensions
```

### Hierarchy Rules

1. **Core tokens**
   → never referenced directly by modules
2. **Semantic tokens**
   → the primary consumption layer
3. **Module-scoped tokens**
   → *exceptions*, not defaults

---

## 3. Core Tokens (Platform-Owned)

Core tokens define raw values only.

Modules:

* ❌ MUST NOT reference core tokens
* ❌ MUST NOT override core tokens

(Your existing color definitions remain unchanged and valid.)

---

## 4. Semantic Tokens (Primary Consumption Layer)

Modules and primitives **MUST consume semantic tokens only**.

### 4.1 Surface

```
surface.default
surface.paper
surface.sunken
surface.raised
```

### 4.2 Border

```
border.default
border.strong
border.subtle
```

### 4.3 Status

```
status.info
status.warning
status.critical
status.success
status.neutral
```

### 4.4 Interactive

```
interactive.hover
interactive.active
interactive.selected
interactive.disabled
interactive.disabled-bg
```

---

## 5. Typography Tokens

(Your existing definitions are correct and unchanged.)

Consumption is **indirect**, via primitives or theme typography mapping.

---

## 6. Spacing Tokens

Canonical scale remains unchanged.

### Enforcement Rule

* ❌ No pixel literals in module UI code
* ❌ No ad-hoc spacing constants
* ✅ Spacing must flow through:

  * `theme.spacing()`
  * approved primitives

---

## 7. Radii Tokens

No changes allowed.

Modules MUST NOT introduce new radii.

---

## 8. Elevation & Shadows

Shadow levels are fixed and semantic.

Modules MUST NOT:

* introduce custom box-shadow values
* bypass elevation tokens

---

## 9. Z-Index Tokens (Strict Ordering)

Your existing z-index hierarchy is correct.

**Additional rule:**
Modules MUST NOT set numeric z-index values directly.

---

## 10. Motion Tokens (Clarified)

Motion tokens are **platform-owned** and consumed via primitives only.

```
motion.duration.fast
motion.duration.normal
motion.duration.slow

motion.easing.standard
motion.easing.decelerate
motion.easing.accelerate
```

Modules:

* ❌ MUST NOT define animations manually
* ✅ MUST rely on primitive behavior

---

## 11. Module-Scoped Tokens (Highly Restricted)

Module-scoped tokens exist **only when semantic tokens are insufficient**.

Rules:

1. Must be approved by UI Platform
2. Must extend semantic meaning, not redefine visuals
3. Must not overlap with core or semantic tokens
4. Must be documented in the module’s UI blueprint
5. Must not be consumed outside the owning module

Violations fail CI.

---

## 12. Token Consumption Rules (Critical)

Modules MUST consume tokens **only via**:

* UI primitives (`ui-component/*`)
* Host theme (`theme.palette`, `theme.spacing`, etc.)

Modules MUST NOT:

* import token JSON
* define CSS variables
* access core token files
* override theme values
* use inline numeric values

---

## 13. MUI Theme Mapping (Canonical)

(Your mapping section is correct; remains authoritative.)

---

## 14. CI & Contract Enforcement

CI validates that:

* No forbidden token imports exist
* No raw values bypass primitives
* No module overrides theme
* No CSS variables are defined by modules

Violations are **CI-fatal**.

---

## 15. Versioning Rules

* Tokens are **append-only**
* Removals require major version bump
* Semantic meaning must remain stable

---

## 16. Relationship to Other Contracts

| Document | Responsibility                |
| -------- | ----------------------------- |
| 02       | What primitives exist         |
| 03       | What values exist             |
| 06       | How primitives consume tokens |
| 07       | Module composition            |
| 12       | Enforcement                   |

---

## End of Design Tokens Contract

---

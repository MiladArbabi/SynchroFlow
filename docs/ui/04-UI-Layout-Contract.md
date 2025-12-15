# **04 — UI Layout Contract (Module-First, Host-Owned)**

**Status:** Authoritative
**Owner:** UI Platform Architecture
**Applies to:** All LaSyncro UI modules
**Scope:** Visual layout, slot composition, rendering boundaries

---

## 0. Executive Summary (Non-Negotiable)

This document defines **only the visual layout contract** between the **Host Shell** and **UI Modules**.

It specifies:

* What layout surfaces a module may render into
* Which layout slots exist and how they are used
* Where the rendering boundary between Host and Module is enforced

This document **does not** define:

* Routing
* Module registration
* Lifecycle
* Entitlements
* Component APIs
* CI enforcement

Those concerns are governed by other contracts and must not be duplicated here.

Any overlap is considered a **contract violation**.

---

## 1. Purpose & Explicit Non-Goals

### 1.1 Purpose

The UI Layout Contract exists to:

* Guarantee consistent visual structure across modules
* Preserve Host ownership of global UI surfaces
* Enable modules to evolve independently without layout fragmentation
* Prevent layout-level coupling between modules

### 1.2 Explicit Non-Goals

This document does **not** define or authorize:

* Route definitions or navigation logic
* Lifecycle hooks or execution order
* Entitlement checks or gating UI
* Data fetching or state management
* UI component APIs

Refer instead to:

* `07-UI-Module-Composition-Contract.md`
* `09-UI-Module-Lifecycle-Contract.md`
* `12-UI-Module-Contract-Rules.md`

---

## 2. Architectural Context

### 2.1 Host Shell Responsibilities

The Host Shell is the **sole owner** of:

* Global header and navigation
* Theme provider and design tokens
* Routing and route guards
* Entitlement resolution
* Suspense and error boundaries
* Global modals, toasts, and overlays

Modules must treat the Host as immutable infrastructure.

---

### 2.2 Module Responsibilities

Each module is responsible for:

* Its internal visual layout
* Composition of its pages and panels
* Correct usage of layout slots
* Respecting layout boundaries

Modules are **guests**, not co-owners, of the application shell.

---

## 3. Module Layout Boundary

### 3.1 Allowed Rendering Area

A module may render **only** within:

* Its allocated layout slots
* Its own DOM subtree

All rendering must be visually and structurally contained.

---

### 3.2 Forbidden Rendering

A module must **never**:

* Render global navigation or headers
* Inject providers above the host
* Modify host layout containers
* Assume viewport ownership
* Render UI outside its slot boundaries

Violations are subject to CI rejection.

---

## 4. Canonical Layout Slots (Authoritative)

The Host exposes a **fixed, versioned set** of layout slots.

### 4.1 Required Slots

| Slot            | Description                    | Owner  |
| --------------- | ------------------------------ | ------ |
| **HeaderSlot**  | Module-scoped header surface   | Module |
| **ContentSlot** | Primary content rendering area | Module |

Both slots are always available when a module is active.

---

### 4.2 Optional Slots

| Slot              | Description                    | Notes                |
| ----------------- | ------------------------------ | -------------------- |
| **SidePanelSlot** | Contextual controls or filters | Collapsible          |
| **ContextPanel**  | Slide-over task/detail surface | Overlay              |
| **FooterSlot**    | Rare, module-scoped footer     | Strongly discouraged |

Modules must not invent additional slots.

---

## 5. Slot Rendering Rules

### 5.1 HeaderSlot Rules

* Renders **below** the global header
* Used for:

  * Module title
  * Breadcrumbs
  * Module-level actions
* Must not replicate or override global navigation

---

### 5.2 ContentSlot Rules

* Scrollable by default
* Hosts:

  * Pages
  * Dashboards
  * Tables
  * Forms
* Must not assume full viewport control

---

### 5.3 SidePanelSlot & ContextPanel Rules

* Must be dismissible
* Must not obscure global navigation
* Must respect z-index tokens
* Must restore focus correctly on close

---

## 6. Layout Composition Rules

### 6.1 Mandatory Layout Wrapper

Every module **must** render all UI through its module layout wrapper.

Rendering pages outside the module layout is forbidden.

---

### 6.2 Internal Composition Freedom

Within its layout boundary, a module may:

* Define sub-layouts
* Nest panels and sections
* Use tabs, accordions, and grids
* Lazy-load internal views

As long as no UI escapes its slots.

---

## 7. Theme & Spacing Constraints (Layout-Scoped)

### 7.1 Theme Ownership

* The Host owns the theme
* Modules may **read**, never override
* Nested `ThemeProvider`s are forbidden

---

### 7.2 Spacing & Sizing

* Use design tokens exclusively
* No fixed viewport assumptions
* No custom breakpoints

---

## 8. Responsiveness & Adaptation

### 8.1 Breakpoints

* Breakpoints are host-defined
* Modules adapt; they do not redefine

---

### 8.2 Collapsing Behavior

* Side panels must collapse on smaller screens
* Content must remain accessible
* Layouts must never dead-end

---

## 9. Accessibility (Layout Scope Only)

Modules must ensure:

* Logical heading hierarchy
* Focus remains within module boundaries
* Overlays trap and restore focus
* Landmarks are meaningful and semantic

Global accessibility is enforced by the Host; local accessibility is enforced by the module.

---

## 10. Error, Empty & Loading States (Visual Only)

Modules may render:

* Empty states
* Inline error surfaces
* Loading skeletons

The Host retains authority over:

* Route-level errors
* Authentication errors
* Entitlement gating UI

---

## 11. Performance Constraints (Layout-Level)

* Layout must render quickly
* Heavy logic must not block first paint
* Panels should mount lazily where possible

No non-layout performance logic belongs here.

---

## 12. Testing Expectations (Layout Only)

Modules should provide:

* Storybook stories for:

  * HeaderSlot
  * ContentSlot
  * SidePanelSlot (if used)
* Visual regression coverage

Lifecycle and contract tests are defined elsewhere.

---

## 13. Governance & Change Management

* Layout slot changes require:

  * UI Architecture review
  * Version bump
  * Migration guidance
* Slots are **append-only**
* Existing slots must never be removed or repurposed

---

## 14. Contract Relationships (Explicit)

This document **depends on**:

* `02-Component-Library-Contract.md`
* `03-Design-Tokens-Contract.md`
* `06-UI-Primitives-Contract.md`

This document is **subordinate to**:

* `07-UI-Module-Composition-Contract.md`
* `09-UI-Module-Lifecycle-Contract.md`
* `12-UI-Module-Contract-Rules.md`

In case of conflict, the latter take precedence.

---

## 15. Final Contract Statement

This contract defines **only the visual layout boundary** between the Host and UI Modules.

Anything outside that boundary is intentionally excluded.

This separation is **by design** and **non-negotiable**.

---

**End of `04-UI-Layout-Contract.md`**
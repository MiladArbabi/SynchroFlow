# ✅ **02-Component-Library-Contract.md**

### **(Normative — Enforced, Minimal, Host-Owned)**

**Status:** 🔐 Locked — Authoritative
**Owner:** UI Platform Architecture
**Audience:** Module authors, platform maintainers, reviewers
**Enforcement:** CI + ESLint + Contract Tests

---

## 1. Purpose (Normative)

The Component Library defines the **only approved UI building blocks** that LaSyncro UI modules may use.

This contract exists to guarantee:

* Visual consistency across modules
* Theme & token correctness
* Accessibility guarantees
* Safe isolation between modules
* Predictable CI enforcement

> **If a component is not defined in this document, it is not part of the public UI contract.**

---

## 2. Source of Truth (Critical)

All canonical UI components are:

* **Owned by the host**
* **Implemented on top of MUI**
* **Re-exported through a controlled namespace**

Modules **must not** import MUI directly.

### ✅ Allowed import namespace

```ts
import { Button, Card, DataGrid } from 'ui-component';
```

### ❌ Forbidden imports (CI enforced)

```ts
@mui/*
@mui/material/*
@mui/x-data-grid
apps/frontend/*
layouts/*
contexts/*
themes/*
```

Violations **fail CI immediately**.

---

## 3. Canonical Component Inventory (Authoritative)

### 3.1 Core Interaction Primitives (Required)

| Component    | Purpose                    |
| ------------ | -------------------------- |
| `Button`     | Primary actions            |
| `IconButton` | Icon-only actions          |
| `Input`      | Text input                 |
| `Textarea`   | Multi-line input           |
| `Select`     | Dropdown selection         |
| `Checkbox`   | Boolean input              |
| `RadioGroup` | Mutually exclusive choices |
| `Switch`     | Boolean toggle             |

---

### 3.2 Layout & Structure Primitives

| Component     | Purpose                    |
| ------------- | -------------------------- |
| `Box`         | Generic layout container   |
| `Stack`       | Linear layout (row/column) |
| `Grid`        | Responsive grid            |
| `Card`        | Surface container          |
| `CardHeader`  | Card header                |
| `CardContent` | Card body                  |
| `Divider`     | Section separation         |

---

### 3.3 Data & State Primitives

| Component    | Purpose                    |
| ------------ | -------------------------- |
| `DataGrid`   | Tabular data (virtualized) |
| `Pagination` | Page navigation            |
| `Skeleton`   | Loading placeholder        |
| `EmptyState` | No-data states             |

---

### 3.4 Feedback & Messaging

| Component  | Purpose           |
| ---------- | ----------------- |
| `Alert`    | Inline feedback   |
| `Snackbar` | Toast messages    |
| `Tooltip`  | Hover context     |
| `Chip`     | Status indicators |
| `Avatar`   | Identity markers  |

---

### 3.5 Navigation / Contextual UI

| Component       | Purpose                  |
| --------------- | ------------------------ |
| `ContextPanel`  | Slide-over panel         |
| `ConfirmDialog` | Destructive confirmation |
| `Modal`         | Blocking dialogs         |
| `PageHeader`    | Page title + actions     |

> **Note:** Navigation chrome (side nav, top bar) is **host-owned** and not exposed as primitives.

---

## 4. Component API Rules (Minimal, Enforced)

Each primitive guarantees a **minimal stable API**.
Implementations may accept more props, but **must support the minimum**.

### Example — `Button`

```ts
<Button
  variant="primary | secondary | text"
  size="small | medium | large"
  disabled?: boolean
  onClick: () => void
>
  Label
</Button>
```

### Example — `DataGrid`

```ts
<DataGrid
  rows={Row[]}
  columns={Column[]}
  loading?: boolean
  onRowClick?: (row) => void
/>
```

**Behavioral guarantees:**

* Keyboard accessible
* Screen-reader compatible
* Dark/light mode safe
* Virtualized where applicable

---

## 5. Theming & Tokens (Strict)

### 5.1 Single Theme Source

* Host owns the MUI theme
* Modules **must not** create `ThemeProvider`
* Modules **must not** override palette, typography, breakpoints

### 5.2 Token Usage

Components resolve styling exclusively through:

```ts
theme.palette
theme.spacing()
theme.typography
theme.shape.borderRadius
```

Hardcoded colors, spacing, or font sizes are **forbidden**.

---

## 6. Styling Rules

Allowed:

* `sx` prop
* CSS Modules
* Styled components scoped to module root

Forbidden:

* Global CSS
* CSS resets
* Unscoped CSS variables
* Inline `<style>` blocks

All CSS variables must be prefixed:

```
--lsyncro-*
```

---

## 7. Extension Rules (Non-Negotiable)

If a module needs a custom component:

* It **must live inside the module**
* It **must not** be exported via `ui-component`
* It **must not** be reused across modules without promotion

Promotion path:

1. Proposal (design + API + accessibility)
2. UI Platform approval
3. Added to this document
4. Storybook + tests
5. Version bump

---

## 8. Versioning & Stability

### Breaking changes (require major bump)

* Removing a component
* Removing a required prop
* Changing visual or behavioral semantics
* Changing import path

### Non-breaking changes

* New optional props
* New components
* Internal refactors

### Deprecation policy

* Minimum **2 release cycles**
* Must log console warnings
* Must be documented

---

## 9. Testing & Quality Gates

Every primitive must include:

* Unit tests
* Accessibility tests (axe)
* Dark/light snapshots
* Storybook coverage

Modules **must not** bypass primitives by rendering raw HTML or MUI components directly.

---

## 10. Governance

* Owned by **UI Platform**
* Changes require UICR approval
* CI enforces compliance
* Drift is not tolerated

---

## End of Document 02 — Component Library Contract
# **06 — UI Primitives Contract (Normative, Enforced)**

**Status:** 🔐 Locked — Enforced
**Owner:** UI Platform Architecture
**Audience:** Module authors, platform maintainers
**Depends on:**

* 02-Component-Library-Contract
* 03-Design-Tokens-Contract
* 08-UI-Host-API-Contract

---

## 1. Purpose (Normative)

This document defines the **exact API, behavior, and accessibility guarantees** of LaSyncro UI primitives.

It does **not** define *which* primitives exist — that is owned by **Document 02**.
This document defines **how they must behave**.

If a primitive violates this contract, it is considered **platform-broken**.

---

## 2. Import Boundary (Strict)

Modules may import primitives **only** via:

```ts
import { Button, Input, DataGrid } from 'ui-component';
```

Modules MUST NOT:

* import from `@mui/*`
* import from host source paths
* wrap or re-export primitives

Violations are **CI-fatal**.

---

## 3. API Stability Rules (Global)

For every primitive:

* Required props **must exist**
* Optional props **must be backward compatible**
* Behavioral semantics **must not change without major version bump**
* No `any`-typed escape hatches

---

## 4. Primitive API Contracts (Canonical)

> Only **representative primitives** are expanded here.
> All other primitives listed in Document 02 follow the same rules.

---

### 4.1 Button

```ts
interface ButtonProps {
  children: React.ReactNode;
  variant: 'primary' | 'secondary' | 'text' | 'danger';
  size: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick: () => void;
  type?: 'button' | 'submit' | 'reset';
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}
```

**Behavioral guarantees**

* Renders a semantic `<button>`
* Keyboard operable (Enter / Space)
* Disabled state blocks interaction
* Focus-visible styles always present

---

### 4.2 Input (Text)

```ts
interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'search' | 'number';
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
}
```

**Guarantees**

* Renders `<input>`
* Emits value only (not event)
* `aria-invalid` set when `error === true`
* Label association enforced when label exists

---

### 4.3 Select (Single)

```ts
interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}
```

**Guarantees**

* Accessible name required
* Keyboard navigation supported
* Screen-reader compatible
* No uncontrolled mode

---

### 4.4 Checkbox / Radio

```ts
interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}
```

**Guarantees**

* Native `<input>` semantics
* Click + keyboard support
* Label is mandatory

---

### 4.5 DataGrid

```ts
interface DataGridProps {
  rows: unknown[];
  columns: ColumnDef[];
  loading?: boolean;
  onRowClick?: (row: unknown) => void;
}
```

**Guarantees**

* Virtualized rendering
* Deterministic row keys
* Loading state shows skeleton
* Keyboard navigation supported

---

### 4.6 Modal / Dialog

```ts
interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}
```

**Guarantees**

* Focus trap enforced
* Escape closes modal
* `aria-modal="true"`
* Focus restored on close

---

## 5. Feedback & Notifications (Critical Correction)

Modules **must not** show global feedback directly.

❌ **Forbidden**

```ts
Toast.show(...)
Snackbar.open(...)
```

✅ **Required**

```ts
host.showToast({
  message: string,
  type?: 'info' | 'success' | 'warning' | 'error'
});
```

Primitives may render **local feedback only**.

---

## 6. Design Token Binding (Strict)

Primitives must consume styling exclusively via:

* `theme.palette`
* `theme.spacing()`
* `theme.typography`
* `theme.shape`

Hardcoded values are forbidden.

---

## 7. Accessibility (Non-Negotiable)

Every primitive must:

* Have a visible focus indicator
* Be keyboard operable
* Have a programmatic name
* Use correct semantic roles
* Avoid div-based interactivity

Accessibility regressions are **release blockers**.

---

## 8. Testing Requirements (CI Enforced)

Each primitive must include:

* Unit tests (props + behavior)
* Accessibility tests (axe)
* Dark / light mode snapshots
* Storybook stories

The contract test harness must be able to:

* Import each primitive
* Render it inside a module shell
* Detect no runtime errors

---

## 9. Change & RFC Process

Any change requires:

1. RFC under `docs/ui/rfcs/`
2. API impact analysis
3. Migration notes
4. Version bump
5. Contract update

---

## 10. Relationship to Other Contracts

| Document | Responsibility        |
| -------- | --------------------- |
| 02       | What primitives exist |
| 03       | Tokens & theme        |
| 06       | API + behavior        |
| 08       | Host-mediated effects |
| 12       | Enforcement           |

---

## End of Document 06 — UI Primitives Contract

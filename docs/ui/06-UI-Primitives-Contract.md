### **UI Primitives Contract — Minimal API Rules & Canonical Approved Primitives (A2)**

---

## **Status**

**Draft → Ready for Review**

## **Owner**

UI Platform Team

## **Purpose**

This document defines the **canonical UI primitives** that all LaSyncro modules must use.
It provides:

* A **minimal API** for each primitive
* A **strict allowed set of variants & props**
* **Design token mapping** requirements
* **Accessibility rules**
* **Testing & Storybook obligations**
* A process for **adding or changing primitives**

**Goal:** Prevent UI fragmentation, stabilize the host surface, guarantee accessibility, and create long-term consistency.

---

# 1. Core Principles

### **1. Minimal API Surface**

Only essential props. No overloading, no open-ended config bags.

### **2. Theme-First Implementation**

All styling must originate from design tokens defined in:

`03-Design-Tokens-Contract.md`

### **3. Accessibility by Default**

Every primitive must ship with built-in a11y patterns:

* semantic HTML whenever possible
* aria attributes
* keyboard navigation
* focus-visible styling

### **4. Testable & Documented**

Every primitive requires:

* Unit tests
* Accessibility tests
* Storybook stories

### **5. Host-Owned & Versioned**

All primitives live under:

`apps/frontend/src/ui-component/*`

Modules **must not** reimplement primitives locally.

---

# 2. Canonical Primitive List

Below is the **approved and required primitive set**.
Modules may only use primitives from this list (unless explicitly approved through the RFC process).

---

## **2.1 Button**

### **Export**

`ui-component/Button`

### **Minimal Props**

```ts
interface ButtonProps {
  children?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  fullWidth?: boolean;
  'aria-label'?: string;
}
```

### **Token Mapping**

* Color: `theme.palette.*`
* Typography: `typography.button`
* Padding: `spacing.md`
* Border radius: `radius.sm`

### **A11y Rules**

* Must render `<button>`.
* Must expose focus-visible styles.
* Must support keyboard activation (Enter/Space).

---

## **2.2 Input (Text)**

### **Export**

`ui-component/Input`

### **Minimal Props**

```ts
interface InputProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  type?: 'text'|'email'|'password'|'search'|'number';
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  name?: string;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  'aria-label'?: string;
}
```

### **A11y**

* `aria-invalid` when `error` is true.
* Must associate label → input whenever a label exists.

---

## **2.3 Select (Single)**

### **Export**

`ui-component/Select`

### **Minimal Props**

```ts
interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}
```

### **A11y**

* Prefer `<select>` element.
* If custom popover: follow ARIA combobox rules.

---

## **2.4 Checkbox / Radio**

### **Exports**

* `ui-component/Checkbox`
* `ui-component/Radio`

### **Props**

```ts
interface CheckboxProps {
  checked?: boolean;
  onChange?: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}
```

### **A11y**

* True `<input type="checkbox">` / `<input type="radio">`
* Linked label required.

---

## **2.5 DataGrid / Table**

### **Export**

`ui-component/DataGrid`

### **Minimal Props**

```ts
interface DataGridProps {
  columns: ColumnDef[];
  rows: any[];
  pagination?: boolean;
  sorting?: boolean;
  onRowClick?: (row: any) => void;
}
```

### **A11y Requirements**

* Semantic `<table>` where possible.
* If virtualized: follow ARIA grid roles with keyboard navigation.

---

## **2.6 Modal / Dialog**

### **Export**

`ui-component/Modal`

### **Minimal Props**

```ts
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}
```

### **A11y**

* Focus trap
* Escape key closes
* `aria-modal="true"`
* Title is labeled by `aria-labelledby`

---

## **2.7 Toast / Snackbar**

### **Export**

`ui-component/Toast` (with static `.show()` helper)

### **API**

```ts
Toast.show({
  message: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: { label: string; onClick: () => void };
});
```

### **A11y**

* Must announce via `aria-live="polite"` or `"assertive"` depending on severity.

---

## **2.8 Avatar & AvatarGroup**

### **Props**

```ts
interface AvatarProps {
  src?: string;
  alt?: string;
  size?: 'sm'|'md'|'lg';
}
```

### **A11y**

* `alt` text required unless decorative.

---

## **2.9 Other Approved Primitives**

Each with minimal APIs & token binding:

* `Card`
* `Skeleton`
* `Chip`
* `Badge`
* `Tooltip`
* `Tabs`
* `Pagination`
* `Breadcrumbs`
* `Spinner`

Each must ship with:

* TypeScript types
* Stories
* Unit tests
* Accessibility tests

---

# 3. Export & Import Rules

### **Allowed**

```ts
import Button from 'ui-component/Button';
import Input from 'ui-component/Input';
```

### **Forbidden**

* Importing components directly from `@mui/*`
* Creating module-specific primitive clones
* Bypassing `ui-component/*` for 3rd-party wrappers

### **Wrapper Rule**

If a module needs something from MUI:
→ it must be wrapped *once* inside `ui-component/wrappers/*`
→ not used directly by modules.

---

# 4. Accessibility Requirements (Global)

For **every primitive**:

* Must provide visible focus indicator.
* Must have a keyboard-accessible activation path.
* Must support screen reader names (`aria-label`, labels, text).
* Overlays must trap focus and restore on close.
* No role misusage or div-based interactive elements (unless ARIA-complete).

---

# 5. Storybook & Test Requirements

### **Stories (minimum 3 per primitive)**

1. Default state
2. Variant(s)
3. Edge case (error, loading, disabled)

### **Unit Tests**

* Rendering & snapshot
* Interaction behavior (click, focus, keyboard)
* Accessibility smoke tests (axe)

### **Contract Test**

The host contract-test harness must be able to:

* import each primitive
* mount it inside a module
* validate no runtime or styling errors occur

---

# 6. Versioning & Change Process

### **Breaking Change Process**

1. RFC file under `docs/ui/rfcs/YYYYMMDD-primitive-change.md`
2. Host review + migration steps
3. 2-release deprecation period with console warnings
4. Optional codemod for large migrations

---

# 7. Adding a New Primitive (RFC Process)

1. Draft RFC with:

   * justification
   * minimal API
   * expected variants
   * token mapping
   * usage examples
2. Implement primitive inside `ui-component/<Name>`
3. Add stories + tests
4. Update this contract document
5. Submit to UI Architecture review

---

# 8. Acceptance Criteria for This Contract

* All primitives listed here exist under `ui-component/*`.
* All primitives follow minimal API specifications.
* All primitives bind exclusively to design tokens.
* Storybook builds successfully and includes each primitive.
* Contract test harness can mount an instance of every primitive.
* CI runs accessibility and behavioral tests for all primitives.

---

# End of Document

---
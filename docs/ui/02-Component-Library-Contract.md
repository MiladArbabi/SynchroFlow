# ✅ **02-Component-Library-Contract.md (Option A2 — Minimal API + Canonical Primitives)**

**Status:** Authoritative Contract — Stable
**Scope:** Defines the minimal, official, versioned UI Component Library for LaSyncro modules.
**Audience:** Module authors, UI architecture, platform maintainers.

---

# **1. Purpose**

The Component Library exists to guarantee UI consistency, theme alignment, accessibility, and cross-module compatibility.
This contract defines:

1. The **canonical list of approved UI primitives**.
2. The **allowed API surface** exposed to modules.
3. The **rules governing usage** of the component system.
4. The **export stability and versioning policy**.

No module may use UI primitives outside this contract unless explicitly approved via Platform Governance.

---

# **2. Canonical Component Inventory (Authoritative)**

Every module MUST source UI building blocks exclusively from the following import namespace:

```
import { <Component> } from "ui-component";
```

## **2.1 Core Primitives**

| Component     | Purpose                            | Status   |
| ------------- | ---------------------------------- | -------- |
| `Button`      | Primary/secondary/tertiary actions | Required |
| `Input`       | Text input with variants           | Required |
| `Select`      | Basic selection control            | Required |
| `Checkbox`    | Boolean input                      | Required |
| `Radio`       | Choice set                         | Required |
| `Switch`      | Boolean toggle                     | Required |
| `Card`        | Container surface                  | Required |
| `CardHeader`  | Card title area                    | Required |
| `CardContent` | Card body                          | Required |
| `Divider`     | Section divider                    | Required |
| `Tooltip`     | Hover info                         | Required |
| `Chip`        | Status tags, labels                | Required |
| `Avatar`      | Identifiers, entities              | Required |

## **2.2 Data Primitives**

| Component    | Purpose                |
| ------------ | ---------------------- |
| `DataGrid`   | Tabular data rendering |
| `Pagination` | Pagination controls    |
| `Skeleton`   | Loading placeholder    |

## **2.3 Feedback Primitives**

| Component                                                              | Purpose                                     |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| `Alert`                                                                | Inline feedback: success/warning/error/info |
| `Snackbar`                                                             | Toast messages                              |
| (If Snackbar is implemented via host → modules MUST use host provider) |                                             |

## **2.4 Layout Primitives**

| Component      | Purpose                                       |
| -------------- | --------------------------------------------- |
| `Box`          | General layout container                      |
| `Grid`         | Responsive layout rows/columns                |
| `Stack`        | Vertical/horizontal alignment                 |
| `ContextPanel` | Slide-over contextual panel (module-scoped)   |
| `MasterPanel`  | Primary-detail layout surface (module-scoped) |

---

# **3. Import Rules**

### **3.1 Allowed import paths**

Only these paths are approved:

```
ui-component/<primitive>
ui-component/cards/<card variants>
ui-component/extended/<approved extended components>
```

### **3.2 Forbidden imports**

Modules MUST NOT import from:

* `@mui/*` directly (unless explicitly allowed)
* host layout components (`MainLayout`, `TopnavbarContent`, etc.)
* theme internals (`palette`, `typography`, override files)
* unapproved third-party libraries

### **3.3 Extension rule**

If a module requires a custom primitive:

* it MUST be placed under the module folder (`modules/<module>/src/ui/components/...`)
* it MUST NOT be placed inside the shared `ui-component` namespace
* it MUST be documented in that module’s UI contract

---

# **4. Theming Rules**

### **4.1 Single Theme Source**

All primitives MUST consume host theme values (colors, spacing, typography) automatically through MUI’s theme injection.
Modules MUST NOT instantiate new themes or wrap their content with new ThemeProviders.

### **4.2 Tokens**

Primitives MUST resolve spacing, color, radii, typography via:

```
theme.spacing()
theme.palette
theme.typography
```

### **4.3 CSS Rules**

* No global CSS.
* Only CSS modules, MUI `sx` props, or styled components with auto-scoping.
* Every custom variable MUST be prefixed: `--lsyncro-*`.

---

# **5. Component API Contract (Minimal Surface)**

The primitives MUST implement the following minimal API guarantees:

## **5.1 Button**

Required props:

```
variant: 'primary' | 'secondary' | 'text'
size: 'small' | 'medium' | 'large'
onClick: () => void
disabled?: boolean
```

Required theme integration:

* uses theme primary color set
* uses spacing scale for padding
* respects disabled opacity rules

## **5.2 Input**

Required props:

```
value: string
onChange: (v: string) => void
placeholder?: string
error?: boolean
helperText?: string
```

Required behavior:

* keyboard accessible
* supports dark/light mode

## **5.3 DataGrid**

Required props:

```
rows: Row[]
columns: Column[]
loading?: boolean
pagination?: PaginationProps
```

Required behavior:

* virtualization for large data sets
* skeleton support for `loading === true`

*(Other primitives follow similar minimal API rules; omitted here because Option A2 requires contract, not examples.)*

---

# **6. Versioning & Stability**

### **6.1 No breaking changes without major version**

Any of the following requires a major version bump:

* Removing a prop
* Changing component behavior
* Renaming a component
* Changing import paths

### **6.2 Additive changes allowed**

New components or optional props may be added in minor versions.

### **6.3 Deprecation window**

Deprecated components MUST remain for **2 releases** before removal.

---

# **7. Testing Requirements**

Every primitive MUST include:

* **Unit tests** validating API surface
* **Theme snapshot tests** validating dark/light behavior
* **Accessibility checks** (axe-core)
* **Storybook stories** for each variant

Modules MUST NOT bypass these primitives by rendering raw HTML controls unless explicitly approved.

---

# **8. Governance Rules**

* The Component Library is owned by **UI Platform**.
* All changes require a **UI Change Request (UICR)**.
* Cross-module primitives must not be created ad-hoc.
* Any new primitive must be explicitly added to this contract.

---

# **End of Component Library Contract (Minimal API + Canonical Primitives)**

---

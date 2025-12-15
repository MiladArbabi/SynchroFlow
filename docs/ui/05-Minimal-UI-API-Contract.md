# Minimal UI Consumption Contract (A2)

**Status:** Normative — Enforced by convention and CI  
**Owner:** UI Platform Architecture  
**Last updated:** 2025-12

---

## Purpose

This document defines the **minimal, non-negotiable rules** that UI modules must follow when **consuming** the LaSyncro UI platform.

It does **not** define host internals, routing mechanics, or lifecycle semantics.

Its role is to ensure that:

- modules remain decoupled from host implementation details,
- UI consistency is preserved across teams,
- future host evolution does not break existing modules.

If you are building a UI module, this document defines **what you are allowed to rely on** and **what you must not do**.

---

## Scope (and explicit non-scope)

### This document **does** define

- Which UI primitives modules may use
- How modules must consume theme and design tokens
- Rules for extending UI primitives
- Testing and compliance expectations
- Governance and backward-compatibility expectations

### This document **does NOT** define

- Host API shape (see **08-UI-Host-API-Contract.md**)
- Routing rules or entitlements behavior (see **05-UI-Routing-Contract.md**)
- Module lifecycle semantics (see **09-UI-Module-Lifecycle-Contract.md**)
- Folder structure or scaffolding (see **10** and **11**)

If this document conflicts with another UI contract, **this document loses**.

---

## Source of Truth Hierarchy

If information appears inconsistent across UI docs, precedence is:

1. **08-UI-Host-API-Contract.md** (authoritative, enforced)
2. **05-UI-Routing-Contract.md**
3. **09-UI-Module-Lifecycle-Contract.md**
4. **This document**

This document never overrides host behavior.

---

## Core principles

1. **Small surface area**  
   Modules depend on as little host surface as possible.

2. **Consumption-only**  
   Modules consume platform capabilities; they do not reimplement or mutate them.

3. **Consistency over flexibility**  
   UI uniformity is more important than local optimization.

4. **Explicit extension**  
   New primitives or patterns require review and promotion — not silent divergence.

---

## Canonical UI primitives

Modules **must use host-provided UI primitives where available**.

If a needed primitive does not exist, the module **may implement it locally**, but it must **not** be treated as a platform dependency.

### Enforced host primitives

The following primitives are provided by the host UI layer and are considered stable:

- **Button**
- **Input**
- **Select**
- **Checkbox**
- **DataGrid**
- **Card**
- **Modal**
- **Toast**
- **GatedPlaceholder**

These primitives live under the host UI component library  
(e.g. `ui-component/*`) and are covered by host-level tests.

Modules must not reimplement these primitives.

---

### Non-contractual helpers

The platform may also expose helper components (e.g. headers, layout helpers, panels).

These are:

- **optional**
- **not guaranteed**
- **not contractually stable**

Modules may use them if available, but **must not depend on them for correctness**.

---

## Gated UI behavior (consumption rules)

Modules **must not** implement custom entitlement gating logic.

Rules for module authors:

- If entitlements are missing or unresolved, rely on host gating behavior.
- When rendering gated content manually, use the host-provided `GatedPlaceholder`.
- Never attempt to infer entitlement state from route presence, nav visibility, or URL.

All entitlement semantics are defined in **05-UI-Routing-Contract.md** and enforced by the host.

---

## Theme & design token usage

### Theme access

- The host theme is **authoritative**.
- Modules may **read** theme values.
- Modules must **not** wrap themselves in a nested ThemeProvider.
- Modules must not mutate theme configuration.

### Design tokens

- Use token names defined in `03-Design-Tokens-Contract.md`.
- Tokens must map to theme values (palette, spacing, typography).
- Hard-coded colors, spacing, or z-index values are prohibited unless documented.

### CSS rules

- Module-scoped CSS only.
- CSS variables must be prefixed with `--lsyncro-`.
- Global selectors are forbidden.

---

## Component extension rules

If a module requires a UI primitive that does not exist:

1. Implement it **locally** inside the module.
2. Do **not** export or reuse it across modules.
3. If reuse is desired, submit a promotion proposal containing:
   - API shape
   - Accessibility considerations
   - Design references
   - Test requirements

Only after approval may a primitive be promoted to the host library and documented here.

---

## Testing & compliance expectations

Modules are expected to:

- Use canonical primitives for all interactive UI
- Avoid importing host internals
- Pass host-provided contract tests
- Include accessibility smoke coverage for primary screens
- Avoid snapshotting host internals or styles

The host CI is authoritative.  
If CI fails, the module is non-compliant regardless of local behavior.

---

## Forbidden behaviors (non-exhaustive)

Modules must never:

- Import from `apps/frontend/src/*`
- Import host routing primitives directly
- Access host contexts or stores
- Modify navigation DOM
- Inject global CSS
- Mutate theme or tokens
- Reimplement entitlement logic
- Depend on undocumented runtime behavior

Violations are treated as contract breaches.

---

## Backward compatibility & governance

- Changes to this document require UI Platform approval.
- Breaking changes require:
  - Semver major bump
  - Migration guidance
  - CI updates
- Deprecated patterns must be supported for **at least two releases**.

---

## Summary for module authors

Before shipping a UI module, confirm:

- [ ] Only documented primitives are used
- [ ] Theme is read-only
- [ ] No host internals are imported
- [ ] Gating is delegated to the host
- [ ] Local primitives are not reused cross-module
- [ ] Contract tests pass

---

**End of Minimal UI Consumption Contract.**

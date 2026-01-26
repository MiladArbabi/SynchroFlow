# 🎨 FT2 Theme & Color Preset Playbook

**(Authoritative · Deterministic · Mode-Safe)**

---

## 0. Core Principles (Non-Negotiable)

1. **No hardcoded colors in primitives**

   * ❌ `#FAFAFA`, `#000`, `rgba(...)`
   * ✅ CSS variables only

2. **No semantic meaning in theme**

   * Theme provides *contrast & legibility*, not *meaning*
   * Meaning lives in `diffTone`, `trustTone`, props

3. **Dark/Light parity**

   * Every FT2 variable **must exist in both schemes**
   * Missing = bug

4. **Scheme-scoped only**

   * ❌ `:root`
   * ✅ `[data-color-scheme="light|dark"]`

---

## 1. Token Ownership Model (Who Defines What)

### A. MUI Theme (apps/frontend)

**Owns:**

* Color schemes
* CSS variables
* Mode switching
* Contrast guarantees

📍 `apps/frontend/src/themes/index.tsx`

---

### B. FT2 / ui-ft2 primitives

**Consume only**

* `var(--ft2-*)`
* Never reference palette directly
* Never branch on `mode`

📍 `modules/ui-ft2/src/**`

---

### C. Modules (Orders, Products, Overview)

**Provide meaning**

* `diffTone`
* `trustTone`
* values, deltas

📍 `modules/*/src/ui/**`

---

## 2. FT2 Variable Naming Convention (Hard Rules)

```
--ft2-{scope}-{role}[-state]
```

### Examples

| Variable                  | Meaning            |
| ------------------------- | ------------------ |
| `--ft2-infoblock-bg`      | surface background |
| `--ft2-infoblock-border`  | structural border  |
| `--ft2-infoblock-diff-up` | positive delta     |
| `--ft2-surface-shadow`    | elevation          |
| `--ft2-surface-divider`   | separators         |

❌ Never reuse MUI variable names
❌ Never encode semantics like “success”, “error”

---

## 3. Required FT2 Variable Matrix (Minimum Set)

### Structural

```
--ft2-surface-bg
--ft2-surface-inset-bg
--ft2-surface-divider
--ft2-surface-shadow
--ft2-surface-shadow-hover
```

### InfoBlock

```
--ft2-infoblock-bg
--ft2-infoblock-border

--ft2-infoblock-header-bg
--ft2-infoblock-header-text

--ft2-infoblock-row-text

--ft2-infoblock-footer-bg
--ft2-infoblock-footer-text
```

### Diff (MANDATORY)

```
--ft2-infoblock-diff-up
--ft2-infoblock-diff-down
--ft2-infoblock-diff-neutral
```

If one is missing → **theme is invalid**

---

## 4. Where Variables Are Defined (Exact Location)

**ONLY here:**

```ts
MuiCssBaseline.styleOverrides = {
  '[data-color-scheme="light"]': { ... },
  '[data-color-scheme="dark"]': { ... },
}
```

📍 `apps/frontend/src/themes/index.tsx`

---

## 5. How Primitives Must Consume Variables

### ✅ Correct (InfoBlock.styles.ts)

```ts
background: 'var(--ft2-infoblock-bg)';
border: '1px solid var(--ft2-infoblock-border)';
color: 'var(--ft2-infoblock-row-text)';
```

### ❌ Incorrect

```ts
background: theme.palette.background.paper;
color: '#353535';
```

---

## 6. Diff Color Resolution (No Logic in JS)

### Rule

* JS selects **tone**
* CSS resolves **color**

### JS

```tsx
<InfoBlockRowDiff data-diff-tone="up" />
```

### CSS

```ts
color: 'var(--ft2-infoblock-diff-neutral)',

'&[data-diff-tone="up"]': {
  color: 'var(--ft2-infoblock-diff-up)',
},
'&[data-diff-tone="down"]': {
  color: 'var(--ft2-infoblock-diff-down)',
},
```

❌ No conditional color logic in React
❌ No `if (tone === 'up')`

---

## 7. Dark / Light Design Rules

### Light Mode

* Backgrounds: off-white, not pure white
* Borders: visible but soft
* Diff colors: saturated but restrained

### Dark Mode

* Backgrounds: neutral dark, not black
* Borders: darker than bg, not lighter
* Diff colors: **desaturated** (avoid neon)

---

## 8. Adding a New FT2 Primitive (Checklist)

Before merging:

* [ ] Uses **only** `--ft2-*` variables
* [ ] No palette imports
* [ ] No hardcoded colors
* [ ] Looks acceptable in both schemes
* [ ] Variables defined in `MuiCssBaseline`
* [ ] Supports neutral state

If any box fails → reject PR

---

## 9. Adding a New Semantic Tone (Future-Safe)

Example: `warning`, `info`, `blocked`

### Steps

1. Add CSS variables (light + dark)
2. Extend data attribute contract
3. Never change existing meaning
4. Default must be `neutral`

---

## 10. What NEVER Goes in Theme

❌ Business meaning
❌ KPI logic
❌ Trend direction
❌ Trust rules
❌ Percent math

Theme is **dumb**, **deterministic**, **passive**

---

## 11. Enforcement Strategy (Strongly Recommended)

* ESLint rule banning hex colors in `ui-ft2`
* Visual regression test per scheme
* Snapshot test asserting all FT2 vars exist

---

## 12. Mental Model (Memorize This)

> **Theme defines contrast.
> Components define structure.
> Modules define meaning.**

If you violate this → entropy creeps in.

---
# FT2 Trust & Data Health Integration Playbook

**(Authoritative, Enforced, Non-Negotiable)**

This document replaces **all prior interpretations** of “Trust FT2”.

If code contradicts this playbook, **the code is wrong**.

---

## 0. What This Playbook Actually Governs (Scope)

This playbook governs **only**:

* FT2 modules
* FT2 surfaces
* FT2 lifecycle visibility

It does **not** govern:

* FT0
* ingestion correctness
* metrics accuracy
* finances reconciliation
* eligibility
* permissions

Trust FT2 answers **one and only one question**:

> “Is it epistemically safe to visually surface FT2 outputs right now?”

Nothing more. Nothing less.

---

## 1. Canonical Definitions (Lock These In)

### 1.1 Trust ≠ Accuracy

Trust does **not** mean:

* “numbers are correct”
* “data is complete”
* “nothing is missing”

Trust means:

> “Displaying this output will not mislead the user about reality.”

A partially complete dataset **can be trusted** if its incompleteness does not invert meaning.

---

### 1.2 Trust Is a Boundary Signal, Not a Diagnostic

Trust:

* does **not** explain
* does **not** warn
* does **not** guide action
* does **not** block navigation

Trust only answers:

* silence vs signal
* safe vs unsafe

---

### 1.3 Null Is Sacred

`null` means:

> “The system has not evaluated trust.”

It does **not** mean:

* unknown data
* partial data
* missing data
* bad data

If trust is `null`, **the UI must say nothing**.

No placeholders. No yellow. No guessing.

---

## 2. Trust Ownership Model (Critical)

Trust is owned by **exactly one layer**.

| Layer             | Allowed to decide trust? |
| ----------------- | ------------------------ |
| Ingestion         | ❌ No                     |
| Facts / metrics   | ❌ No                     |
| FT2 Evaluator     | ❌ No                     |
| Backend Trust FT2 | ✅ **Yes (only here)**    |
| Frontend hooks    | ❌ No                     |
| Adapters          | ❌ No                     |
| UI components     | ❌ No                     |

If trust logic appears anywhere else, it is a bug.

---

## 3. Canonical Architecture (Final, Locked)

```
Backend Trust FT2 (decision)
   ↓
Frontend Trust Snapshot (transport)
   ↓
Module Adapter (shape only)
   ↓
Module UI (tone derivation)
   ↓
FT2Surface (visual boundary)
```

Each layer has **exactly one responsibility**.

No layer may leak into the next.

---

## 4. Backend: Trust FT2 (Decision Layer)

### 4.1 Endpoint (Immutable)

```
GET /api/v1/modules/trust/ft2
```

No alternatives. No per-module endpoints.

---

### 4.2 Response Contract (Immutable)

```ts
interface TrustFT2Response {
  trustEligible: boolean | null;
}
```

No additional fields.
No explanations.
No reasons.
No metadata.

---

### 4.3 Semantics (Read Carefully)

| Value   | Meaning             | UI Obligation      |
| ------- | ------------------- | ------------------ |
| `true`  | Epistemically safe  | May surface        |
| `false` | Unsafe / misleading | Must visually mark |
| `null`  | Not evaluated       | Must remain silent |

**Important**
`false` does **not** mean “blocked from rendering”.
It means “rendered but clearly constrained”.

---

### 4.4 Backend Enforcement Rules

The backend **must not**:

* infer trust from partial ingestion
* downgrade trust due to missing enrichment
* change trust based on UI needs

Trust FT2 evaluates **structural safety only**:

* joins are valid
* time windows stable
* entities are internally consistent

---

## 5. Frontend: Trust FT2 Snapshot Hook (Transport Layer)

### 5.1 Location (Fixed)

```
apps/frontend/src/pages/trust/useTrustFt2Snapshot.ts
```

No duplication. No variants.

---

### 5.2 Responsibilities (Exactly These)

✅ Fetch Trust FT2
✅ Attach auth
✅ Normalize failures to `null`

❌ Interpret
❌ Map
❌ Derive UI meaning
❌ Cache aggressively

---

### 5.3 Transport Rules (Hard Requirement)

* **MUST** use `axiosInstance`
* **MUST NOT** use `fetch`
* **MUST NOT** throw
* **MUST NOT** log errors to console (noise)

---

### 5.4 Canonical Behavior Table

| HTTP      | Result                           |
| --------- | -------------------------------- |
| `200`     | return `{ trustEligible }`       |
| `204`     | return `{ trustEligible: null }` |
| `401/403` | return `{ trustEligible: null }` |
| `>=500`   | return `{ trustEligible: null }` |

Silence is always safer than inference.

---

## 6. Adapters: Structural Normalization Only

### 6.1 Allowed

Adapters may:

* forward `trustEligible`
* widen types
* fill **only** with `null`

Example:

```ts
{
  trustEligible,
  trustTone: null
}
```

---

### 6.2 Forbidden (Zero Tolerance)

Adapters must **never**:

* compute `trustTone`
* collapse `null → false`
* rename trust fields
* drop trust entirely
* derive UI meaning

If an adapter touches trust semantics, it is invalid.

---

## 7. Module UI: Trust Interpretation (Local & Explicit)

### 7.1 Where This Happens

Inside **each FT2 module root component**.

Examples:

* `OrdersModuleFT2.tsx`
* `OverviewModuleFT2.tsx`
* `ProductsModuleFT2.tsx`

Never shared. Never abstracted.

---

### 7.2 Canonical Derivation Logic (Locked)

```ts
let trustTone: 'trusted' | 'constrained' | 'blocked' | undefined;

if (trustEligible === true) trustTone = 'trusted';
else if (trustEligible === false) trustTone = 'blocked';
else trustTone = undefined;
```

**Important**
There is **no automatic yellow** at this layer.

Yellow is a **visual interpretation**, not a trust decision.

---

### 7.3 Why This Matters

This prevents:

* false warnings
* UI overreach
* trust inflation

The UI **reacts**, it does not judge.

---

## 8. FT2Surface: Visual Boundary (Pure Rendering)

### 8.1 Props (Immutable)

```ts
interface FT2SurfaceProps {
  trustTone?: 'trusted' | 'constrained' | 'blocked';
}
```

---

### 8.2 Rendering Rules (Strict)

* Left border only
* Full height
* 2–4px width
* No text
* No tooltip
* No icons
* No value coloring

If any of the above appear, the component is invalid.

---

### 8.3 Color Tokens (Single Source of Truth)

Defined **only** in:

```
modules/ui-ft2/src/layout/tokens.ts
```

No module-local colors.
No overrides.
No gradients.

---

## 9. Visual Semantics (User-Facing Meaning)

| trustTone     | Meaning      | User Interpretation              |
| ------------- | ------------ | -------------------------------- |
| `trusted`     | Safe to read | “These numbers won’t mislead me” |
| `constrained` | Caution      | “Some context may be missing”    |
| `blocked`     | Unsafe       | “This could be misleading”       |
| `undefined`   | Silent       | “System hasn’t evaluated this”   |

The UI **never explains why**.

Explanation belongs elsewhere (tooltips on metrics, not trust).

---

## 10. Debugging Playbook (Deterministic)

When trust visuals don’t appear:

1. **Network**

   ```
   GET /api/v1/modules/trust/ft2
   ```

   * Must return `200`
   * Anything else → trust must be `null`

2. **Snapshot Hook**

   * Must use `axiosInstance`
   * Must not throw

3. **Adapter**

   * Must pass trust through untouched

4. **Module UI**

   * Must derive `trustTone`
   * Must pass to FT2Surface

5. **FT2Surface**

   * Must receive prop

If any step fails → **no bar is correct behavior**.

---

## 11. Anti-Patterns (These Break the System)

Absolutely forbidden:

* ❌ Blocking modules based on trust
* ❌ Explaining trust in text
* ❌ Coloring numbers
* ❌ Adding warnings or badges
* ❌ Inferring trust from data quality
* ❌ “Helpful” fallback logic
* ❌ Recomputing trust in frontend

Trust inflation destroys credibility faster than missing data.

---

## 12. Expansion Rules (Future-Proof)

When adding Trust to a new FT2 module:

1. Import `useTrustFt2Snapshot`
2. Fetch at page composition level
3. Pass through adapter untouched
4. Derive `trustTone` locally
5. Pass to **every** FT2Surface
6. Do not special-case

If a module violates this flow, it is not FT2-compliant.

---

## 13. Final Mental Model (Internalize This)

> FT2 unlocks *visibility*
> Trust defines *safety*
> Silence is better than confidence
> Confidence is better than explanation

If engineers follow this playbook mechanically, the system will:

* scale
* remain honest
* never surprise users
* never need re-education

This is the stable end-state.
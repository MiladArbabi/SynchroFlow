# Core Epistemic Contract Playbook

**Status:** 🔒 LOCKED
**Applies to:** Backend, Frontend, Modules, Shared Packages
**Effective From:** Phase A (Epistemic Introduction)
**Owner:** Platform Architecture Consortium
**Last Verified:** Green build across all workspaces

---

## 1. Purpose of This Playbook

This document defines **how LaSyncro represents knowledge**.

It exists to eliminate ambiguity between:

* `unknown`
* `null`
* `zero`
* inferred values
* assumed values
* computed-but-untrusted values

If this playbook is violated, **the system will lie** — silently.

---

## 2. Foundational Principle (Non-Negotiable)

> **The system must always distinguish between:**
>
> *What is known*
> *What is unknown*
> *What is partially known*

Silence, coercion, or fallback behavior is **architectural corruption**.

---

## 3. The Epistemic Primitive (Canonical)

### 3.1 `EpistemicValue<T>`

```ts
export interface EpistemicValue<T> {
  value: T | null;
  state: 'KNOWN' | 'INCOMPLETE' | 'UNKNOWN';
  explanation?: string;
  completenessRatio?: number;
  evaluatedAt: string;
}
```

### 3.2 Semantic Guarantees

| Field               | Meaning                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `value`             | The computed value. `null` means **not computable**, not zero.                  |
| `state`             | Explicit knowledge state. Must NEVER be inferred by consumers.                  |
| `explanation`       | Human-readable justification. Mandatory outside Phase A when `state !== KNOWN`. |
| `completenessRatio` | Optional confidence metric (0–1). Only valid for `INCOMPLETE`.                  |
| `evaluatedAt`       | Temporal traceability. Required for debugging and replay.                       |

---

## 4. What Epistemic Is NOT

Epistemic **does NOT**:

* Perform business logic
* Perform inference
* Decide UI states
* Replace scenario logic
* Hide values
* Normalize data
* “Fix” missing inputs

It is **structural truth only**.

---

## 5. Null Is Sacred (Critical Rule)

> **`null` is a first-class state.**

### Absolute rules:

* ❌ `null` must NEVER be coerced to `0`
* ❌ `null` must NEVER be replaced with defaults
* ❌ `null` must NEVER be hidden
* ✅ `null` must flow end-to-end until explicitly resolved

If data is missing, **the system must admit ignorance**.

---

## 6. Phase A Migration Contract (Locked)

### 6.1 Purpose of Phase A

Phase A exists to:

* Introduce epistemic structure
* Preserve existing behavior
* Avoid UI or logic changes
* Surface knowledge boundaries explicitly

### 6.2 The ONLY Allowed Adapter in Phase A

```ts
legacyToEpistemic<T>(value: T | null): EpistemicValue<T>
```

#### Mapping (Fixed)

| Input            | Output           |
| ---------------- | ---------------- |
| `value !== null` | `state: KNOWN`   |
| `value === null` | `state: UNKNOWN` |

No other logic is allowed in Phase A.

---

## 7. Public API Naming Rule (MANDATORY)

### Internal name (truthful):

```ts
legacyToEpistemic
```

### Public alias (ergonomic):

```ts
toEpistemic
```

#### Why this split exists

* Keeps migration intent explicit
* Avoids long-term semantic lies
* Enables Phase B replacement
* Prevents epistemic inflation

**Do NOT rename the internal function.**

---

## 8. Where Epistemic Adapters May Be Used

### Allowed Locations

| Layer                    | Allowed |
| ------------------------ | ------- |
| Module UI composition    | ✅       |
| Frontend adapters        | ✅       |
| Backend response shaping | ✅       |
| Shared contracts         | ✅       |

### Forbidden Locations

| Location                   | Reason              |
| -------------------------- | ------------------- |
| Inside business logic      | Corrupts semantics  |
| Inside DB queries          | Leaks inference     |
| Inside UI rendering logic  | Violates separation |
| Inside scenario resolution | Double inference    |

---

## 9. Data Flow Invariant (Locked)

```
DB facts
  ↓
Backend signals (raw)
  ↓
Frontend adapters (pure)
  ↓
Epistemic wrapping (explicit)
  ↓
Scenario resolution (single authority)
  ↓
UI rendering
```

Breaking this order is a **hard violation**.

---

## 10. Scenario Logic vs Epistemic Logic (Do NOT Mix)

| Concern                   | Owner             |
| ------------------------- | ----------------- |
| Is data known?            | EpistemicValue    |
| What does it mean?        | Scenario resolver |
| What should user see?     | UI                |
| What should we recommend? | Later phases      |

Epistemic answers **“Do we know this?”**
Scenarios answer **“What does that imply?”**

---

## 11. Rendering Rules (Phase A)

### Phase A UI Rules

* UI may read `.value` directly
* UI must NOT branch on `.state`
* UI must NOT hide epistemic absence
* UI behavior must remain unchanged

Any visual logic based on epistemic state is **Phase B+ only**.

---

## 12. Testing Requirements (MANDATORY)

Every epistemic integration must include:

1. **Null propagation test**
2. **KNOWN vs UNKNOWN mapping test**
3. **No-zero-coercion test**
4. **Adapter-only responsibility test**

If tests pass without these, the test suite is incomplete.

---

## 13. Anti-Patterns (Explicitly Forbidden)

❌ Casting:

```ts
value as EpistemicValue<number>
```

❌ Silent defaults:

```ts
toEpistemic(value ?? 0)
```

❌ Inference:

```ts
state: value ? 'KNOWN' : 'UNKNOWN'
```

❌ UI guessing:

```ts
if (!epistemic.value) showEmpty()
```

---

## 14. Phase Progression Rules

| Phase   | What Changes                        |
| ------- | ----------------------------------- |
| Phase A | Structure only                      |
| Phase B | Rendering reacts to epistemic state |
| Phase C | Explanation enforcement             |
| Phase D | Confidence-aware UX                 |
| Phase E | Decision systems                    |

Skipping phases is forbidden.

---

## 15. Enforcement Mechanisms (Strongly Recommended)

* ESLint rule banning `null → 0`
* ESLint rule banning epistemic construction outside adapters
* CI check ensuring `EpistemicValue` always has `evaluatedAt`
* Contract tests for shared adapters

---

## 16. Final Lock Statement

> **Epistemic is the system’s conscience.**

If the system does not know something,
**it must say so — explicitly, structurally, and consistently.**

Any attempt to “smooth” this truth is a defect.

🔒 **Locked. Enforced. Non-negotiable.**

---
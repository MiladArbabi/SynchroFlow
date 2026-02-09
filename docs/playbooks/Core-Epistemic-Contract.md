# Core Epistemic Contract Playbook

**Status:** 🔒 LOCKED  
**Applies to:** Backend, Frontend, Modules, Shared Packages  
**Effective From:** Phase A (Epistemic Introduction)  
**Owner:** Platform Architecture Consortium  
**Last Verified:** Green build across all workspaces

```typescript
Database Facts
→ Facts Services (raw, null-honest)
→ Epistemic Computation (do we know?)
→ Intelligence (what does it mean?)
→ FT2 Exposure (what may be shown?)
→ UI (how it’s presented)
```
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

## 2.1 Canonical Knowledge Flow (LOCKED)

All system reasoning MUST follow this order:

```
Facts (DB truth, null-honest)
  ↓
Epistemic computation (EpistemicValue<T>)
  ↓
Intelligence classification (internal-only meaning)
  ↓
Exposure policy (FT2 / visual / API)
```

**Violations include:**

* Intelligence producing epistemic state
* Epistemic making decisions
* Exposure upgrading certainty
* UI inferring meaning from raw facts

This order was validated end-to-end in Phases 8–18.

---

## 3. The Epistemic Primitive (Canonical)

### 3.1 `EpistemicValue<T>`

```typescript
export interface EpistemicValue<T> {
  value: T | null;
  state: 'KNOWN' | 'INCOMPLETE' | 'UNKNOWN';
  explanation?: string;
  completenessRatio?: number;
  evaluatedAt: string;
}
```

### 3.1.1 Declaration Authority (CRITICAL)

`EpistemicValue<T>` and `EpistemicState` MUST originate from `@lasyncro/epistemic` **compiled declarations**.

Source imports, shadow interfaces, or local re-definitions are forbidden.

**Rationale:**

* TypeScript exhaustiveness depends on emitted `.d.ts`
* Missing declarations silently collapse unions
* Downstream packages lose epistemic guarantees without compile errors

### 3.2 Semantic Guarantees

| Field | Meaning |
| :--- | :--- |
| `value` | The computed value. `null` means **not computable**, not zero. |
| `state` | Explicit knowledge state. Must NEVER be inferred by consumers. |
| `explanation` | Human-readable justification. Mandatory outside Phase A when `state !== KNOWN`. |
| `completenessRatio` | Optional confidence metric (0–1). Only valid for `INCOMPLETE`. |
| `evaluatedAt` | Temporal traceability. Required for debugging and replay. |

---

### 3.3 Exhaustiveness Is a Contract

Any logic branching on `EpistemicState` MUST be exhaustive.

**Allowed pattern:**

```typescript
switch (value.state) {
  case 'KNOWN': …
  case 'INCOMPLETE': …
  case 'UNKNOWN': …
  default: {
    const _exhaustive: never = value.state;
    throw new Error(`Unhandled EpistemicState: ${_exhaustive}`);
  }
}
```

---

## 4. What Epistemic Is — and Is NOT

Epistemic **does NOT**:

* Perform business logic
* Perform inference
* Decide UI states
* Replace scenario logic
* Hide values
* Normalize data
* “Fix” missing inputs

It is **structural truth only**.

Epistemic answers ONE question only:

> **“Do we know this value, partially know it, or not know it at all?”**

**Epistemic MUST NOT:**

* Gate decisions
* Assess risk
* Evaluate safety
* Unlock features
* Classify outcomes

Those responsibilities belong to **Intelligence** and **Exposure Policy**.

---

## 5. Null Is Sacred (Critical Rule)

> **`null` is a first-class state.**

### Absolute rules

* ❌ `null` must NEVER be coerced to `0`
* ❌ `null` must NEVER be replaced with defaults
* ❌ `null` must NEVER be hidden
* ✅ `null` must flow end-to-end until explicitly resolved

If data is missing, the system must admit ignorance — even if:

* The database has rows outside the queried range
* Other endpoints return non-null values
* Business intuition suggests an answer

Epistemic truth is range-scoped, fact-scoped, and time-scoped.

**NOTE:**  
`null` may exist inside `EpistemicValue`, but MUST NOT exist inside visual or UI-level contracts.

Conversion from `null` → display placeholder is allowed ONLY in epistemic → visual projection.

---

## 6. Phase A Migration Contract (Locked)

### 6.1 Purpose of Phase A

Phase A exists to:

* Introduce epistemic structure
* Preserve existing behavior
* Avoid UI or logic changes
* Surface knowledge boundaries explicitly

### 6.2 The ONLY Allowed Adapter in Phase A

```typescript
legacyToEpistemic<T>(value: T | null): EpistemicValue<T>
```

#### Mapping (Fixed)

| Input | Output |
| :--- | :--- |
| `value !== null` | `state: KNOWN` |
| `value === null` | `state: UNKNOWN` |

No other logic is allowed in Phase A.

### 6.3 Fact-Limited Unlock Rule (LOCKED)

System capability MUST improve only when:

* New factual inputs are introduced
* Existing facts gain higher coverage
* Previously null facts become non-null

The following MUST NOT unlock capability:

* New logic
* New thresholds
* New heuristics
* New interpretations
* New adapters

If behavior changes without new facts, the system is lying.

---

## 7. Public API Naming Rule (MANDATORY)

### Internal name (truthful)

```typescript
legacyToEpistemic
```

### Public alias (ergonomic)

```typescript
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

| Layer | Allowed |
| :--- | :--- |
| Module UI composition | ✅ |
| Frontend adapters | ✅ |
| Backend response shaping | ✅ |
| Shared contracts | ✅ |

### Forbidden Locations

| Location | Reason |
| :--- | :--- |
| Inside business logic | Corrupts semantics |
| Inside DB queries | Leaks inference |
| Inside UI rendering logic | Violates separation |
| Inside scenario resolution | Double inference |

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

### 9.1 Epistemic Injection Rule

Epistemic values MAY be injected into downstream layers ONLY IF:

* They were computed strictly from facts
* They were not altered or reclassified
* They are passed verbatim
* Injection does not bypass intelligence

**Example (Allowed):**  
Facts → Epistemic → FT2 downgrade

**Example (Forbidden):**  
Facts → Intelligence → Epistemic → FT2

---

## 10. Scenario Logic vs Epistemic Logic (Do NOT Mix)

| Concern | Owner |
| :--- | :--- |
| Is data known? | EpistemicValue |
| What does it mean? | Scenario resolver |
| What should user see? | UI |
| What should we recommend? | Later phases |

Epistemic answers **“Do we know this?”**  
Scenarios answer **“What does that imply?”**

---

### 10.1 Decision Safety Is NOT Epistemic

**Decision safety:**

* Is an intelligence classification
* Depends on fact completeness
* Must fail closed
* Must NOT be overridden by epistemic certainty

Epistemic certainty does NOT imply decision safety.

**Example:**

* Revenue epistemic = KNOWN
* Costs epistemic = UNKNOWN  
→ Decision safety MUST remain UNSAFE

This invariant is enforced in Finances FT2 and is non-negotiable.

---

## 11. Rendering Rules (Phase-Aware)

### Phase A (Migration)

* UI may read `.value`
* UI MUST NOT branch on `.state`
* No visual differentiation
* Behavior must remain unchanged

### Phase B

* UI may react to epistemic state
* Interpretation MUST be centralized
* Components may NOT inspect `EpistemicValue` directly

### Phase C (Current)

* UI receives ONLY `EpistemicVisualSignal`
* Epistemic → Visual mapping occurs exactly once
* Rendering MUST NOT fail silently
* Tooltip, tone, and icon are optional but typed

### Phase D+

* UX may adapt based on confidence
* Policy decisions still forbidden in UI

---

### 11.1 Canonical Visual Projection (MANDATORY)

All epistemic UI rendering MUST pass through a visual projection layer.

**Example output type:**

```typescript
interface EpistemicVisualSignal {
  display: string;
  tooltip?: string;
  tone: 'neutral' | 'warning' | 'error' | 'info';
  icon?: 'check' | 'warning' | 'alert' | 'info';
}
```

---

## 12. Testing Requirements (MANDATORY)

Every epistemic integration must include:

1. **Null propagation test**
2. **KNOWN vs UNKNOWN mapping test**
3. **No-zero-coercion test**
4. **Adapter-only responsibility test**
5. Exhaustive `EpistemicState` switch test
6. `.d.ts` emission verification test for `@lasyncro/epistemic`
7. Cross-package type identity test (no shadow interfaces)

If tests pass without these, the test suite is incomplete.

---

## 13. Anti-Patterns (Explicitly Forbidden)

❌ **Casting:**

```typescript
value as EpistemicValue<number>
```

❌ **Silent defaults:**

```typescript
toEpistemic(value ?? 0)
```

❌ **Inference:**

```typescript
state: value ? 'KNOWN' : 'UNKNOWN'
```

❌ **UI guessing:**

```typescript
if (!epistemic.value) showEmpty()
```

❌ **Shadow typing:**

```typescript
interface EpistemicValue<T> { … }
```

❌ **Local visual signal re-definitions:**

```typescript
type EpistemicVisualSignal = …
```

❌ **Importing epistemic types from source paths:**

```typescript
import { EpistemicValue } from '../epistemic'
```

---

### 13.1 Epistemic Endpoints (Additive Only)

Epistemic endpoints:

* MUST be additive
* MUST NOT replace FT2
* MUST NOT include intelligence
* MUST NOT include decisions
* MUST reflect query-scoped facts only

They exist to expose truth — not readiness.

---

## 14. Phase Progression Rules

| Phase | What Changes |
| :--- | :--- |
| Phase A | Structural epistemic introduction |
| Phase B | UI may observe epistemic state |
| Phase C | Explanations enforced |
| Phase D | Confidence-aware UX |
| Phase E | Decision systems (fact-gated only) |

Progression REQUIRES new facts.  
Logic-only progression is forbidden.

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

### Architectural Law (Derived)

> The system may only become more confident  
> when reality provides more evidence.

All other forms of “progress” are illusions.

---

# ADDENDUMS

---

# ADDENDUM A — Finances-Specific Epistemic Addendum

**Status:** 🔒 LOCKED
**Scope:** Finances domain only
**Applies to:** Facts, Epistemic, Intelligence, FT2 Exposure

### A.1 Placement

**Place this entire addendum after Section 16 (Final Lock Statement).**

---

### A.2 Canonical Financial Facts (Non-Negotiable)

**Replace any informal description of finances facts with:**

```md
Finances Facts are the sole source of monetary truth.

Canonical facts include:
- totalRevenue
- totalCosts
- netResult
- refundsObserved
- dataCoverage.completenessPct
- timeSeries.points

Rules:
- Facts are DB-derived only
- Facts preserve nulls
- Facts perform no interpretation
```

---

### A.3 Finances Epistemic Computation Contract

**Place this section under Addendum A**

```md
Finances Epistemic Computation MUST obey:

Revenue:
- null → UNKNOWN
- completenessPct === 100 → KNOWN
- otherwise → INCOMPLETE

Net Result:
- revenue UNKNOWN → UNKNOWN
- costs null → INCOMPLETE
- revenue + costs known → KNOWN

Refunds:
- null → UNKNOWN
- ≥ 0 → KNOWN

Epistemic output MUST NOT:
- infer materiality
- infer safety
- infer readiness
```

---

### A.4 FT2 Interaction Rule (Critical)

**Add this rule:**

```md
FT2 MAY consume Finances Epistemic values
ONLY to downgrade exposure.

Epistemic certainty MUST NEVER:
- upgrade decisionSafety
- override intelligence
- unlock outcomes
```

---

### A.5 Proven Invariant (Audited)

```md
KNOWN revenue + UNKNOWN costs
→ decisionSafety MUST remain UNSAFE
```

---

# ADDENDUM B — Decision Safety Playbook

**Status:** 🔒 LOCKED
**Owner:** Intelligence Layer Only
**Audience:** Backend engineers, reviewers

---

### B.1 Placement

**Place this addendum after Addendum A.**

---

### B.2 Definition (Authoritative)

**Replace any informal definition of decision safety with:**

```md
Decision Safety answers:
“Is acting on this data risky?”

It is:
- Conservative
- Fail-closed
- Intelligence-owned
```

---

### B.3 Decision Safety Inputs (Locked)

```md
Decision Safety MAY depend on:
- dataCoverage.completenessPct
- costsMissing
- historyInsufficient

Decision Safety MUST NOT depend on:
- EpistemicValue.state alone
- UI context
- Business goals
```

---

### B.4 Decision Safety Matrix (Canonical)

```md
IF costsMissing OR historyInsufficient
→ decisionSafety = UNSAFE

IF completenessPct === 100
AND costsKnown
AND historySufficient
→ decisionSafety = SAFE

ELSE
→ decisionSafety = UNKNOWN
```

---

### B.5 Absolute Prohibitions

```md
❌ EpistemicValue MUST NOT set decisionSafety
❌ FT2 MUST NOT override decisionSafety
❌ UI MUST NOT reinterpret decisionSafety
```

---

# ADDENDUM C — Fact Expansion Playbook

*(Costs / Refunds / Time)*

**Status:** 🔒 LOCKED
**Purpose:** Enable safe system evolution without semantic drift

---

### C.1 Placement

**Place this addendum after Addendum B.**

---

### C.2 Fact Expansion Is the ONLY Growth Mechanism

**Insert this rule:**

```md
System capability may expand ONLY by adding facts.

Logic, heuristics, or thresholds
do NOT count as progress.
```

---

### C.3 Costs Expansion Protocol

```md
To unlock costs:

1. Introduce a canonical cost source
2. Guarantee row-level integrity
3. Populate totalCosts (non-null)
4. Preserve nulls during rollout
5. Recompute epistemic
6. Observe intelligence unlocks naturally
```

❌ Estimation is forbidden
❌ Backfilling with assumptions is forbidden

---

### C.4 Refunds Expansion Protocol

```md
Refunds MUST be:
- Explicitly ingested
- Canonically linked
- Sign-correct
- Null when absent

Refunds MUST NOT:
- Be inferred from revenue drops
- Be approximated
```

---

### C.5 Time / History Expansion Protocol

```md
Time sufficiency improves ONLY when:
- More buckets are observed
- Continuity increases
- Coverage remains 100%

Time MUST NOT be padded or gap-filled.
```

---

### C.6 Unlock Cascade (Observed)

```md
New Facts
→ Epistemic upgrades
→ Intelligence confidence improves
→ Decision safety may unlock
→ FT2 exposure changes
```

Skipping any step is forbidden.

---

## FINAL ADDENDUM LOCK

```md
These addendums are extensions of the Core Epistemic Contract.

Violating them creates:
- False confidence
- Unsafe decisions
- Irreversible semantic debt

🔒 Locked. Audited. Enforced.
```

---

This architecture mirrors the thinkers you referenced:

Steve Jobs: ruthless clarity, fewer concepts, deeply correct.
Elon Musk: first-principles truth, not legacy shortcuts.
Ogilvy / Mary Wells: confidence without exaggeration.
Kotler: product integrity before promotion.
Seth Godin: permission and trust — don’t overclaim.
Bernays: shaping perception responsibly, not deceptively.
Henry Ford: systems that scale because parts are standardized.

In short:
The system now earns trust instead of borrowing it.
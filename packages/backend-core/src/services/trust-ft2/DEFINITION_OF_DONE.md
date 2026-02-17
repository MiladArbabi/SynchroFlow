# Trust FT2 — Definition of Done (FROZEN)

## Purpose

Trust FT2 is the **terminal epistemic gate** for FT2.

It answers **one question only**:

> Is it epistemically safe to expose downstream FT2 realities?

Trust FT2:
- Does NOT explain trust
- Does NOT score trust
- Does NOT rank or weight signals
- Does NOT infer causality
- Does NOT degrade downstream data

It produces a **binary gate with epistemic silence**.

---

## Entry Point

- `getTrustFt2Snapshot({ shopId })` is the **single authoritative entry point**
- Time range is **backend-owned**
- No UI-provided parameters are accepted

---

## Core Responsibility

Trust FT2 **converges existing FT2-safe trust signals** into a single gate.

It does **not** compute new facts or intelligence.

---

## Signal Sources (Explicit Dependencies)

Trust FT2 MAY depend only on:

- Product Data Integrity FT2
- Product Data Freshness FT2

These dependencies are **explicit and mandatory**.
No other domains are allowed.

---

## Semantic Mapping Rules (NON-INFERENTIAL)

### Product Data Integrity → Trust

Mapping is **contractual**, not analytical:

| Product Integrity (FT2) | Trust Interpretation |
|-------------------------|----------------------|
| `ok`                    | `consistent`         |
| `attention`             | `inconsistent`       |
| `unknown` / `null`      | `unknown`            |

No other mappings are allowed.

---

### Product Data Freshness → Trust

Freshness is **presence-based only**.

Rules:
- Any `null` exposure → `unknown`
- Any domain marked `fresh` → `fresh`
- All domains `stale` → `stale`

No time deltas.
No thresholds.
No decay logic.

---

## Trust Gate Rules (HARD INVARIANT)

Trust eligibility is determined as follows:

- If **any signal is `unknown`** → `trustEligible = null`
- If **any signal is unsafe** → `trustEligible = false`
- Only if **all signals are safe** → `trustEligible = true`

There is **no partial trust**.

---

## Epistemic Silence

`null` does **not** mean false.

It means:
- Truth is unavailable
- Truth is withheld
- Or truth cannot be asserted safely

This silence must be preserved downstream.

---

## Output Contract

### `TrustFt2Snapshot`

```ts
{
  dataFreshness: 'fresh' | 'stale' | 'unknown' | null
  dataIntegrity: 'consistent' | 'inconsistent' | 'unknown' | null
  trustEligible: boolean | null
}
````

Rules:

* Snapshot shape is **always returned**
* No fields are omitted
* No fields are enriched or defaulted

---

## Forbidden Behavior (NON-NEGOTIABLE)

Trust FT2 MUST NOT:

* Recompute facts
* Recompute intelligence
* Introduce scoring or weighting
* Explain outcomes
* Emit partial truth
* Leak domain semantics downstream
* Depend on lifecycle, billing, or entitlements

---

## Error Semantics

Trust FT2 **must not throw** due to:

* Missing providers
* Null FT2 exposures
* Unknown signals

Errors are reserved **only** for programmer mistakes
(e.g. contract violations, unreachable code).

---

## Downstream Contract

Downstream consumers (e.g. Overview FT2):

* MUST treat `trustEligible !== true` as a hard block
* MUST NOT reinterpret or override trust
* MUST NOT degrade trust further

---

## Test Coverage (MANDATORY)

The following must be covered by unit tests:

* Safe → `trustEligible = true`
* Unsafe → `trustEligible = false`
* Any unknown → `trustEligible = null`
* Full snapshot shape always returned
* Correct semantic mapping from dependencies
* No throws on missing or null inputs

Tests must fail if:

* Trust logic is enriched
* Partial truth is emitted
* Any dependency is bypassed

---

## Final Status

Trust FT2 is considered **DONE** when:

* It acts as a pure gate
* All logic is deterministic
* All semantics are explicit
* All tests are green
* No TODOs or “temporary” behavior remains

This file is **frozen**.
Any changes require an explicit architectural decision.

---

# Overview FT2 — Definition of Done (FROZEN)

## Purpose

Overview FT2 is the **terminal aggregation surface** for FT2.
It exists to present a **single, trust-gated snapshot** that composes
already-downgraded FT2 domain realities.

Overview FT2:

- Does **not** compute facts
- Does **not** derive intelligence
- Does **not** evaluate trust
- Does **not** explain or interpret data

It is strictly a **composition and gating layer**.

---

## Entry Point

- `getOverviewFt2Snapshot({ shopId })` is the **single authoritative entry point**
- Time range is **not accepted** from callers
- All time authority is backend-owned

---

## Trust Gating (HARD INVARIANT)

Overview FT2 is **absolutely trust-gated**.

### Rules

- Trust eligibility is inherited **only** from Trust FT2
- Overview FT2 **must not** evaluate, infer, or override trust
- Overview FT2 **must not** degrade or explain trust state

### Behavior

- If `trust.trustEligible !== true`:
  - Resolver **returns `null`**
  - Controller responds with **HTTP 204**
  - No partial snapshot is allowed
  - No error is thrown

This behavior is **intentional epistemic silence**.

---

## Composition Rules

Overview FT2 may compose **only FT2-safe snapshots**:

- Orders → OrderNexus FT2
- Products → Products FT2
- Customers → Customers FT2
- Specter → Specter FT2
- Trust → Trust FT2 (hard dependency)

### Forbidden Actions

Overview FT2 MUST NOT:

- Enrich missing values
- Default `null` or `unknown` values
- Infer metrics or outcomes
- Reinterpret domain semantics
- Collapse or merge domain signals
- Introduce lifecycle, billing, or entitlement logic

---

## Snapshot Shape Guarantees

When returned (i.e. trustEligible === true):

- The snapshot shape is **structurally complete**
- Individual subtrees **may be null**
- No subtree may be fabricated or inferred

When trust-gated:

- Resolver returns `null`
- No partial object is ever returned

---

## Time Semantics

- Overview FT2 owns **no time semantics**
- Downstream resolvers that require a range:
  - Must receive a `{ preset: 'custom', from, to }` range
  - Derived exclusively from backend FT2 period authority
- Overview FT2 must never accept or forward raw `{ from, to }` as a range

---

## Error Semantics

- Overview FT2 **must not throw** for:
  - Missing downstream data
  - Null FT2 snapshots
  - Trust gating
- Errors are reserved **only** for:
  - Explicitly declared operational blocking states

---

## Operational Blocking

During phased rollout, Overview FT2 may be:

> Structurally complete, operationally blocked

In this state:

- Trust gate is enforced
- Resolver throws **only after** trust eligibility is confirmed
- This throw must be explicit and intentional
- Tests must assert this behavior

---

## Controller Semantics

- `GET /api/v1/ft2/overview`
- Responses:
  - `204 No Content` → trust-gated
  - `200 OK` → snapshot returned
- No error payloads
- No explanatory metadata

---

## Test Coverage (MANDATORY)

The following must be covered by unit tests:

- Trust-gated `null` return
- HTTP 204 behavior at controller level
- No throws when downstream FT2 snapshots are null
- No enrichment or inference of domain values
- Snapshot shape stability
- Range wrapping for downstream resolvers

Tests must fail if:

- Partial snapshots are returned
- Trust is re-evaluated
- Any defaulting logic is introduced

---

## Final Status

Overview FT2 is considered **DONE** when:

- Trust FT2 is a hard dependency
- Resolver returns `OverviewFt2Snapshot | null`
- Controller correctly maps `null → 204`
- No TypeScript contract violations exist
- All composition tests are green
- No TODOs or soft assumptions remain

This file is **frozen**.
Any future changes require an explicit architectural decision.
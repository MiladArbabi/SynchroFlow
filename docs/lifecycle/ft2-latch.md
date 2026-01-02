# FT2 Backend Capability Latch

FT2 is an explicit backend capability milestone.

## Properties

- Persisted in `ft2_state`
- Written deliberately
- Never inferred
- Not tied to payment
- Not a UX concern

## Lifecycle Rule

FT2 is entered if and only if:

- FT1 is complete
- ft2_state exists for the shop

Payment and entitlements do not affect lifecycle.

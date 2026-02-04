# Customer Obligations — Canonical Rules

Customer obligations exist ONLY when backed by
`customer_blocking_events`.

Allowed sources:

- Explicit disputes
- Explicit customer action requirements
- Manual merchant holds

Forbidden:

- payment_state
- retries
- aging
- heuristics

If no unresolved event exists → customer is NOT blocking.

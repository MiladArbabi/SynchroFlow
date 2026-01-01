# MarginCore – Financial Intelligence Module (v1 Locked Blueprint)

## Mission
Be the **single source of truth** for **shop-level cost models** and **financial policies**, and the **only producer** of `CostModelSnapshot` + `CostModelVersioning` for LaSyncro – without ever computing order-level profit.

> **Important**: Any change to locked types or interfaces requires a versioned contract (`v2`) and a migration plan. No ad-hoc edits.

## Responsibilities & Boundaries

### MarginCore OWNS
* **Cost model definition per shop**
  - `CostModelSnapshot` (locked shape)
  - Shipping, handling, packaging, payment fees, overhead, tax, margin thresholds
* **Cost model lifecycle**
  - Draft → Active → Archived
  - Single active model per shop
* **Versioning & recomputation policy**
  - `CostModelVersioning` with version tracking
  - Emitting `CostModelUpdatedEvent` to OrderNexus
* **Admin-facing APIs**
  - Create draft cost models
  - Activate with explicit recomputation strategy
  - List history and changes
* **Guardrails**
  - Validation of models (percent ranges, non-negative costs, currency)
  - Recomputation blast radius guard (window & quota)
  - RBAC for who can change/activate models
* **Outbox & reliability**
  - Durable event log for cost model updates
  - Idempotent publishing to message bus

### MarginCore DOES NOT OWN
* Order-level profit computation → **OrderNexus**
* SKU-level inventory & demand → **SKU OS**
* Customer behavior / LTV → **Specter**
* Cash flow / P&L / forecasting dashboards → **Analytics Core**
* Warehouse / tasks / workflows → **WMS Lite**, **Echo Hub**
* Circuit breakers → **consumers** (OrderNexus) via `ModuleCircuitBreaker`
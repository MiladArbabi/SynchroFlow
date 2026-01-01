# MarginCore – Internal Architecture (v1)

## Subsystems Overview

### 1. Cost Model Store
* Persists `CostModelSnapshot` with lifecycle state (`draft`, `active`, `archived`)
* Enforces **at most 1 active** model per shop

### 2. Cost Model Management
* `CostModelManagementService`
* Creates drafts with validation
* Activates models with single transaction: activate + outbox message
* `RecomputationGuard` checks

### 3. FinanceClient Implementation
* `FinanceClientImpl` (cache-aside pattern)
* In-memory + Redis cache keyed by `shopId`
* Read-only; no writes

### 4. Outbox + Publisher
* `finance_outbox_messages` table
* `OutboxRepository` + `OutboxWorker`
* Publishes `CostModelUpdatedEvent` to message bus for OrderNexus

### 5. RecomputationGuard
* Enforces:
  - Max historical window for `all_orders_since`
  - Daily recomputation quota per shop (orders affected)
* Uses cheap order-count estimates from OrderNexus/Analytics

### 6. RBAC Integration
* Middleware enforcing:
  - `ROLE_FINANCE_ADMIN` (shop scope)
  - `ROLE_PLATFORM_ADMIN` (cross-shop / high-risk recompute)

### 7. (Optional v1) Simulation Service
* Internal service to simulate impact of a draft model on last N days of orders via a simulation endpoint on OrderNexus

## System Dependencies

```mermaid
graph TD
    A[MarginCore] --> B[PostgreSQL<br/>finance_cost_models]
    A --> C[Redis Cache]
    A --> D[Message Bus<br/>CostModelUpdatedEvent]
    E[OrderNexus] --> A
    F[Finance Admin UI] --> A
    
    B -->|Active model| A
    C -->|Cache| A
    A -->|Event publishing| D
    D -->|Consumes| E
    
    style A fill:#f9f,stroke:#333
    style E fill:#ccf,stroke:#333
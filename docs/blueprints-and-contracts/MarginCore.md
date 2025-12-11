# MarginCore – Financial Intelligence Module (v1 Locked Blueprint)

> **Mission:** Be the **single source of truth** for **shop-level cost models** and **financial policies**, and the **only producer** of `CostModelSnapshot` + `CostModelVersioning` for LaSyncro – without ever computing order-level profit.

Any change to locked types or interfaces requires a versioned contract (`v2`) and a migration plan. No ad-hoc edits.

---

## 0. Responsibility & Boundaries

### 0.1 MarginCore OWNS

* **Cost model definition per shop**

  * `CostModelSnapshot` (locked shape)
  * Shipping, handling, packaging, payment fees, overhead, tax, margin thresholds
* **Cost model lifecycle**

  * Draft → Active → Archived
  * Single active model per shop
* **Versioning & recomputation policy**

  * `CostModelVersioning` with:

    * `versionId`
    * `source`
    * `updatedAt`
    * `recomputationScope` + `recomputationSince`
  * Emitting `CostModelUpdatedEvent` to OrderNexus
* **Admin-facing APIs**

  * Create draft cost models
  * Activate with explicit recomputation strategy
  * List history and changes
* **Guardrails**

  * Validation of models (percent ranges, non-negative costs, currency)
  * Recomputation blast radius guard (window & quota)
  * RBAC for who can change/activate models
* **Outbox & reliability**

  * Durable event log for cost model updates
  * Idempotent publishing to message bus

### 0.2 MarginCore DOES NOT OWN

* Order-level profit computation → **OrderNexus**
* SKU-level inventory & demand → **SKU OS**
* Customer behavior / LTV → **Specter**
* Cash flow / P&L / forecasting dashboards → **Analytics Core**
* Warehouse / tasks / workflows → **WMS Lite**, **Echo Hub**
* Circuit breakers → **consumers** (OrderNexus) via `ModuleCircuitBreaker`

---

## 1. Locked External Contracts

These are **frozen** and already referenced inside LaSyncro. MarginCore must implement them exactly.

### 1.1 Cost Model to OrderNexus

```ts
// LOCKED – from LaSyncro blueprint

export interface CostModelSnapshot {
  shopId: number;
  currency: string;

  shippingCostModelId: string;
  handlingCostPerOrder: number;
  packagingCostPerUnit: number;
  paymentFeePercent: number;
  paymentFeeFixed: number;
  overheadAllocationPercent: number;
  taxRatePercent: number;

  minAcceptableMarginPercent: number;
  maxCostToServePercentOfRevenue: number;

  updatedAt: string;
}

export interface CostModelVersioning {
  versionId: string;           // 'finance:2025-01-10T12:00:00Z' | 'local:timestamp'
  source: 'finance' | 'local';
  updatedAt: string;           // ISO

  recomputationScope: 'none' | 'new_orders_only' | 'all_orders_since';
  recomputationSince?: string; // REQUIRED when 'all_orders_since'
}
```

### 1.2 Finance Client Contract (Consumer-facing)

```ts
// Public API used by OrderNexus CostModelService

export interface FinanceClient {
  getCostModel(shopId: number): Promise<CostModelSnapshot | null>;
}
```

**Rules:**

* Returns **active cost model** for `shopId`, or `null` if none (OrderNexus falls back to `BASIC_COST_MODEL`).
* Must be **low-latency** and read-oriented (cache heavily).
* Must not throw for “no model”; return `null` instead.

---

## 2. Internal Architecture (MarginCore)

### 2.1 Subsystems

1. **Cost Model Store**

   * Persists `CostModelSnapshot` with lifecycle state (`draft`, `active`, `archived`).
   * Enforces **at most 1 active** model per shop.

2. **Cost Model Management**

   * `CostModelManagementService`
   * Creates drafts with validation.
   * Activates models with:

     * Single transaction: activate + outbox message.
     * `RecomputationGuard` checks.

3. **FinanceClient Implementation**

   * `FinanceClientImpl` (cache-aside pattern).
   * In-memory + Redis cache keyed by `shopId`.
   * Read-only; no writes.

4. **Outbox + Publisher**

   * `finance_outbox_messages` table.
   * `OutboxRepository` + `OutboxWorker`.
   * Publishes `CostModelUpdatedEvent` to message bus for OrderNexus.

5. **RecomputationGuard**

   * Enforces:

     * Max historical window for `all_orders_since`.
     * Daily recomputation quota per shop (orders affected).
   * Uses cheap order-count estimates from OrderNexus/Analytics.

6. **RBAC Integration**

   * Middleware enforcing:

     * `ROLE_FINANCE_ADMIN` (shop scope).
     * `ROLE_PLATFORM_ADMIN` (cross-shop / high-risk recompute).

7. **(Optional v1) Simulation Service**

   * Internal service to simulate impact of a draft model on last N days of orders via a simulation endpoint on OrderNexus.

---

## 3. Data Model

### 3.1 Cost Models Table

```sql
CREATE TABLE finance_cost_models (
  id UUID PRIMARY KEY,
  shop_id INTEGER NOT NULL,

  status VARCHAR(16) NOT NULL CHECK (status IN ('draft', 'active', 'archived')),

  -- Mirrors CostModelSnapshot
  currency VARCHAR(8) NOT NULL,
  shipping_cost_model_id VARCHAR(64) NOT NULL,
  handling_cost_per_order DECIMAL(10,2) NOT NULL,
  packaging_cost_per_unit DECIMAL(10,2) NOT NULL,
  payment_fee_percent DECIMAL(5,2) NOT NULL,
  payment_fee_fixed DECIMAL(10,2) NOT NULL,
  overhead_allocation_percent DECIMAL(5,2) NOT NULL,
  tax_rate_percent DECIMAL(5,2) NOT NULL,
  min_acceptable_margin_percent DECIMAL(5,2) NOT NULL,
  max_cost_to_serve_percent_of_revenue DECIMAL(5,2) NOT NULL,

  -- Versioning metadata (null for drafts)
  version_id VARCHAR(128),
  source VARCHAR(16) NOT NULL DEFAULT 'finance',  -- 'finance' | 'local'
  updated_at TIMESTAMPTZ NOT NULL,

  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  notes TEXT
);

-- SINGLE active model per shop, enforced by DB
CREATE UNIQUE INDEX idx_finance_cost_models_shop_active
  ON finance_cost_models (shop_id)
  WHERE status = 'active';
```

### 3.2 Outbox Table

```sql
CREATE TABLE finance_outbox_messages (
  id UUID PRIMARY KEY,
  type VARCHAR(64) NOT NULL,      -- e.g. 'COST_MODEL_UPDATED_V1'
  payload JSONB NOT NULL,         -- { version: 1, shopId, costModelVersion }
  created_by VARCHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX idx_finance_outbox_unprocessed
  ON finance_outbox_messages (processed_at, created_at);
```

---

## 4. Core Services & Flows

### 4.1 CostModelRepository (Core DB Abstraction)

```ts
export type CostModelStatus = 'draft' | 'active' | 'archived';

export interface CostModelRecord {
  id: string;
  shopId: number;
  status: CostModelStatus;
  snapshot: CostModelSnapshot;
  versionId: string | null;   // null for drafts
  source: 'finance' | 'local';
  createdBy: string;
  createdAt: string;
  activatedAt?: string;
  deactivatedAt?: string;
  notes?: string;
}

export interface CostModelRepository {
  getActiveCostModel(shopId: number): Promise<CostModelRecord | null>;

  createDraftModel(input: {
    shopId: number;
    snapshot: CostModelSnapshot;
    createdBy: string;
    notes?: string;
  }): Promise<CostModelRecord>;

  /**
   * MUST run inside a DB transaction:
   * - Archives current active model (if any)
   * - Activates the new one
   */
  activateModel(
    costModelId: string,
    activatedBy: string,
    trx?: DbTransaction
  ): Promise<CostModelRecord>;

  listModels(shopId: number): Promise<CostModelRecord[]>;
}
```

### 4.2 CostModelValidator

```ts
export class CostModelValidator {
  static assertValid(snapshot: CostModelSnapshot): void {
    const percentFields: Array<keyof CostModelSnapshot> = [
      'paymentFeePercent',
      'overheadAllocationPercent',
      'taxRatePercent',
      'minAcceptableMarginPercent',
      'maxCostToServePercentOfRevenue'
    ];

    for (const field of percentFields) {
      const value = snapshot[field] as unknown as number;
      if (value < 0 || value > 100) {
        throw new Error(`InvalidCostModel: ${field} must be between 0 and 100`);
      }
    }

    if (snapshot.handlingCostPerOrder < 0) throw new Error('InvalidCostModel: handlingCostPerOrder < 0');
    if (snapshot.packagingCostPerUnit < 0) throw new Error('InvalidCostModel: packagingCostPerUnit < 0');
    if (snapshot.paymentFeeFixed < 0) throw new Error('InvalidCostModel: paymentFeeFixed < 0');

    // v1: assume single shop currency; enforce ISO-ish shape
    if (!/^[A-Z]{3}$/.test(snapshot.currency)) {
      throw new Error('InvalidCostModel: currency must be 3-letter ISO code');
    }
  }
}
```

### 4.3 CostModelManagementService (Activation + Outbox)

```ts
export type RecomputationStrategy =
  | { scope: 'none' }
  | { scope: 'new_orders_only' }
  | { scope: 'all_orders_since'; since: string }; // ISO

export interface CostModelManagementResult {
  snapshot: CostModelSnapshot;
  versioning: CostModelVersioning;
}

export class CostModelManagementService {
  constructor(
    private readonly repo: CostModelRepository,
    private readonly outbox: OutboxRepository,
    private readonly guard: RecomputationGuard,
    private readonly db: DbClient,           // for transactions
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async createDraftModel(input: {
    shopId: number;
    snapshot: Omit<CostModelSnapshot, 'updatedAt'>;
    createdBy: string;
    notes?: string;
  }): Promise<CostModelRecord> {
    const snapshot: CostModelSnapshot = {
      ...input.snapshot,
      updatedAt: this.clock().toISOString()
    };

    CostModelValidator.assertValid(snapshot);

    return this.repo.createDraftModel({
      shopId: input.shopId,
      snapshot,
      createdBy: input.createdBy,
      notes: input.notes
    });
  }

  async activateModelWithStrategy(
    costModelId: string,
    activatedBy: string,
    strategy: RecomputationStrategy
  ): Promise<CostModelManagementResult> {
    const { isValid, errors } =
      await this.guard.validateRecomputationStrategy(costModelId, strategy);

    if (!isValid) {
      throw new Error(`InvalidRecomputationStrategy: ${errors.join('; ')}`);
    }

    let activated: CostModelRecord;
    let version: CostModelVersioning;

    await this.db.transaction(async (trx) => {
      activated = await this.repo.activateModel(costModelId, activatedBy, trx);

      const nowIso = this.clock().toISOString();

      version = {
        versionId: `finance:${nowIso}`,
        source: 'finance',
        updatedAt: nowIso,
        recomputationScope: strategy.scope,
        recomputationSince:
          strategy.scope === 'all_orders_since' ? strategy.since : undefined
      };

      const payload = {
        version: 1,
        shopId: activated!.shopId,
        costModelVersion: version
      };

      await this.outbox.append(
        {
          type: 'COST_MODEL_UPDATED_V1',
          payload,
          createdBy: activatedBy
        },
        trx
      );
    });

    // Cache invalidation AFTER commit
    // (Implementation-specific: keying by shopId is recommended)
    // await this.cache.delete(activated!.shopId);

    this.logger.info('FINANCE_COST_MODEL_ACTIVATED', {
      shopId: activated!.shopId,
      costModelId,
      versionId: version!.versionId,
      recomputationScope: version!.recomputationScope
    });

    return { snapshot: activated!.snapshot, versioning: version! };
  }
}
```

---

## 5. Public APIs (Admin & Internal)

### 5.1 Admin – Create Draft

```http
POST /api/finance/v1/shops/:shopId/cost-models/draft
Authorization: Bearer <JWT with ROLE_FINANCE_ADMIN>

Body:
{
  "currency": "USD",
  "shippingCostModelId": "default_flat_10",
  "handlingCostPerOrder": 3.5,
  "packagingCostPerUnit": 0.75,
  "paymentFeePercent": 2.9,
  "paymentFeeFixed": 0.3,
  "overheadAllocationPercent": 15,
  "taxRatePercent": 0,
  "minAcceptableMarginPercent": 10,
  "maxCostToServePercentOfRevenue": 40,
  "notes": "Stripe fee change Jan 2025"
}
```

* Requires `ROLE_FINANCE_ADMIN` with access to `shopId`.
* Validates snapshot; on success returns draft record.

### 5.2 Admin – Activate Model

```http
POST /api/finance/v1/cost-models/:costModelId/activate
Authorization: Bearer <JWT>

Body:
{
  "strategy": {
    "scope": "all_orders_since",
    "since": "2025-01-01T00:00:00Z"
  }
}
```

Middleware:

* `ROLE_FINANCE_ADMIN` for:

  * `scope: 'none'`
  * `scope: 'new_orders_only'`
  * Limited `all_orders_since` (e.g. <= 30 days & below quota).
* `ROLE_PLATFORM_ADMIN` required for high-impact `all_orders_since` if past window/volume thresholds.

On success:

* Activates model.
* Appends `COST_MODEL_UPDATED_V1` to outbox (transactionally).
* Outbox worker later publishes event to OrderNexus.

---

## 6. Observability & Metrics

MarginCore must expose at least:

```ts
const FINANCE_METRICS = {
  cost_models: {
    active_models_per_shop: 'Gauge – should be 0 or 1',
    drafts_per_shop: 'Gauge',
    cost_model_fetch_latency_ms: 'Histogram'
  },
  recomputation: {
    cost_model_updates_total: 'Counter',
    cost_model_updates_with_all_orders_since: 'Counter',
    cost_model_simulations_run: 'Counter'
  },
  outbox: {
    outbox_messages_pending: 'Gauge',
    outbox_messages_failed: 'Counter',
    outbox_publish_latency_ms: 'Histogram'
  }
};
```

Consumers (OrderNexus) already cover:

* `cost_model_recomputation_queued`
* `cost_model_recomputation_failed`
* Circuit breaker metrics for `finance`.

---

## 7. Phase 1 Scope (What v1 Actually Includes)

### Included (v1 – Locked)

* Single-currency cost models per shop (no FX).
* `CostModelSnapshot` + `CostModelVersioning` implementation.
* Draft / active / archived lifecycle with “one active per shop”.
* `FinanceClient.getCostModel` with caching.
* Outbox-based `CostModelUpdatedEvent` publishing.
* Basic `RecomputationGuard`:

  * Max window (e.g. 30–90 days configurable).
  * Daily recomputation quota per shop.
* RBAC integration for:

  * `ROLE_FINANCE_ADMIN`
  * `ROLE_PLATFORM_ADMIN`
* **Optional but strongly recommended**: internal simulation endpoint for last N days.

### Explicitly NOT Included in v1

* FX / multi-currency handling.
* Channel-specific cost models (per channel/region).
* UI dashboards (that’s Analytics Core’s job).
* Advanced scenario planning (“what-if” engine for multiple models at once).
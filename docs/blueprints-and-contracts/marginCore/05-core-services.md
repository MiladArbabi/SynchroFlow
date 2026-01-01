# MarginCore – Core Services & Flows (v1)

## Repository Pattern

### CostModelRepository (Core DB Abstraction)

```typescript
export interface CostModelRepository {
  /**
   * Retrieves the active cost model for a shop
   */
  getActiveCostModel(shopId: number): Promise<CostModelRecord | null>;

  /**
   * Creates a new draft cost model
   */
  createDraftModel(input: {
    shopId: number;
    snapshot: CostModelSnapshot;
    createdBy: string;
    notes?: string;
  }): Promise<CostModelRecord>;

  /**
   * Activates a cost model (must run in transaction)
   * - Archives current active model (if any)
   * - Activates the new one
   */
  activateModel(
    costModelId: string,
    activatedBy: string,
    trx?: DbTransaction
  ): Promise<CostModelRecord>;

  /**
   * Lists all cost models for a shop
   */
  listModels(shopId: number): Promise<CostModelRecord[]>;
}
```

## Validation Layer

### CostModelValidator

```typescript
export class CostModelValidator {
  static assertValid(snapshot: CostModelSnapshot): void {
    const percentFields: Array<keyof CostModelSnapshot> = [
      'paymentFeePercent',
      'overheadAllocationPercent',
      'taxRatePercent',
      'minAcceptableMarginPercent',
      'maxCostToServePercentOfRevenue'
    ];

    // Validate percentage fields (0-100%)
    for (const field of percentFields) {
      const value = snapshot[field] as unknown as number;
      if (value < 0 || value > 100) {
        throw new Error(`InvalidCostModel: ${field} must be between 0 and 100`);
      }
    }

    // Validate non-negative cost fields
    if (snapshot.handlingCostPerOrder < 0) {
      throw new Error('InvalidCostModel: handlingCostPerOrder < 0');
    }
    if (snapshot.packagingCostPerUnit < 0) {
      throw new Error('InvalidCostModel: packagingCostPerUnit < 0');
    }
    if (snapshot.paymentFeeFixed < 0) {
      throw new Error('InvalidCostModel: paymentFeeFixed < 0');
    }

    // Validate currency format (basic ISO check)
    if (!/^[A-Z]{3}$/.test(snapshot.currency)) {
      throw new Error('InvalidCostModel: currency must be 3-letter ISO code');
    }
  }
}
```

## Business Logic Layer

### CostModelManagementService

```typescript
export type RecomputationStrategy =
  | { scope: 'none' }
  | { scope: 'new_orders_only' }
  | { scope: 'all_orders_since'; since: string }; // ISO format

export interface CostModelManagementResult {
  snapshot: CostModelSnapshot;
  versioning: CostModelVersioning;
}

export class CostModelManagementService {
  constructor(
    private readonly repo: CostModelRepository,
    private readonly outbox: OutboxRepository,
    private readonly guard: RecomputationGuard,
    private readonly db: DbClient,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /**
   * Creates a draft cost model with validation
   */
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

  /**
   * Activates a cost model with recomputation strategy
   */
  async activateModelWithStrategy(
    costModelId: string,
    activatedBy: string,
    strategy: RecomputationStrategy
  ): Promise<CostModelManagementResult> {
    // Validate recomputation strategy with guardrails
    const { isValid, errors } =
      await this.guard.validateRecomputationStrategy(costModelId, strategy);

    if (!isValid) {
      throw new Error(`InvalidRecomputationStrategy: ${errors.join('; ')}`);
    }

    let activated: CostModelRecord;
    let version: CostModelVersioning;

    // Transaction: activate model + write to outbox
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

      // Append outbox message for async processing
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

    // Post-transaction: cache invalidation
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

## FinanceClient Implementation

### FinanceClientImpl

```typescript
export class FinanceClientImpl implements FinanceClient {
  constructor(
    private readonly repo: CostModelRepository,
    private readonly cache: CacheClient,
    private readonly logger: Logger
  ) {}

  async getCostModel(shopId: number): Promise<CostModelSnapshot | null> {
    const cacheKey = `finance:cost-model:${shopId}`;
    
    // Try cache first
    const cached = await this.cache.get<CostModelSnapshot>(cacheKey);
    if (cached) {
      this.logger.debug('FINANCE_COST_MODEL_CACHE_HIT', { shopId });
      return cached;
    }

    // Cache miss: fetch from database
    this.logger.debug('FINANCE_COST_MODEL_CACHE_MISS', { shopId });
    const record = await this.repo.getActiveCostModel(shopId);
    
    if (!record) {
      return null; // No active model - OrderNexus will use fallback
    }

    // Cache with TTL (e.g., 5 minutes)
    await this.cache.set(cacheKey, record.snapshot, { ttl: 300 });
    
    return record.snapshot;
  }
}
```

## Service Dependencies

```mermaid
graph TD
    A[CostModelManagementService] --> B[CostModelRepository]
    A --> C[OutboxRepository]
    A --> D[RecomputationGuard]
    A --> E[DbClient]
    
    F[FinanceClientImpl] --> B
    F --> G[CacheClient]
    
    H[Admin API] --> A
    I[OrderNexus] --> F
    
    style A fill:#ddf,stroke:#333
    style F fill:#dfd,stroke:#333
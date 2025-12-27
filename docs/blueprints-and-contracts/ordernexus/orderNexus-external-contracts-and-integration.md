# OrderNexus - External Contracts & Integration**
**Version:** 2.0 (Locked Blueprint)
**Last Updated:** 2025-01-15
**Related Documents:**
- OrderNexus - Core Architecture & Boundaries
- OrderNexus - Engine Implementation
- OrderNexus - CNS Integration Blueprint

---

## 2. External Contracts – Locked Interfaces

### 2.1 Specter ↔ OrderNexus

```typescript
// packages/order-nexus/src/contracts/specter-contract.ts

export interface SpecterCustomerSignal {
  shopId: number;
  hashedCustomerId: string;
  specterCustomerTier: 'VIP' | 'CORE' | 'PROMO_DEPENDENT' | 'RISKY' | 'UNKNOWN';
  predictedLTV: number;
  churnRisk: number;        // 0–1
  priceSensitivity: number; // 0–1
  returnsRisk: number;      // 0–1
  updatedAt: string;        // ISO string
}

export const createDefaultCustomerSignal = (
  shopId: number,
  hashedCustomerId: string
): SpecterCustomerSignal => ({
  shopId,
  hashedCustomerId,
  specterCustomerTier: 'UNKNOWN',
  predictedLTV: 0,
  churnRisk: 0.5,
  priceSensitivity: 0.5,
  returnsRisk: 0.1,
  updatedAt: new Date().toISOString()
});

export interface CustomerProfitabilitySnapshot {
  shopId: number;
  hashedCustomerId: string;
  realizedRevenue: number;
  realizedGrossProfit: number;
  realizedNetProfit: number;
  ordersCount: number;
  lastOrderAt: string;
  profitabilityTier: 'SUPER_WHALE' | 'WHALE' | 'DOLPHIN' | 'MINNOW' | 'SHARK';
  updatedAt: string;
}
```

### 2.2 Financial Intelligence ↔ OrderNexus

```typescript
// packages/order-nexus/src/contracts/finance-contract.ts

export interface CostModelSnapshot {
  shopId: number;
  currency: string;

  // Cost structures
  shippingCostModelId: string;
  handlingCostPerOrder: number;
  packagingCostPerUnit: number;
  paymentFeePercent: number;             // e.g. 2.9 = 2.9%
  paymentFeeFixed: number;
  overheadAllocationPercent: number;     // e.g. 15 = 15%
  taxRatePercent: number;

  // Policy thresholds
  minAcceptableMarginPercent: number;
  maxCostToServePercentOfRevenue: number;

  updatedAt: string;
}

export interface NormalizedCostModel {
  handlingCostPerOrder: number;
  packagingCostPerUnit: number;
  paymentFeePercent: number;
  paymentFeeFixed: number;
  overheadAllocationPercent: number;
  taxRatePercent: number;
  minAcceptableMarginPercent: number;
  maxCostToServePercentOfRevenue: number;
  currency: string;
}

export const BASIC_COST_MODEL: Omit<NormalizedCostModel, 'currency'> = {
  handlingCostPerOrder: 3.5,
  packagingCostPerUnit: 0.75,
  paymentFeePercent: 2.9,
  paymentFeeFixed: 0.3,
  overheadAllocationPercent: 15.0,
  taxRatePercent: 0.0,
  minAcceptableMarginPercent: 10.0,
  maxCostToServePercentOfRevenue: 40.0
};

export interface CostModelVersioning {
  versionId: string;           // e.g. 'finance:2025-01-10T12:00:00Z'
  source: CostModelSource;     // 'finance' | 'local'
  updatedAt: string;
}
```

**Cost Model Service:**

```typescript
// packages/order-nexus/src/services/cost-model-service.ts

export class CostModelNormalizer {
  normalize(
    shopId: number,
    externalModel?: CostModelSnapshot
  ): NormalizedCostModel {
    if (!externalModel) {
      return {
        ...BASIC_COST_MODEL,
        currency: 'USD'
      };
    }

    return {
      handlingCostPerOrder: externalModel.handlingCostPerOrder,
      packagingCostPerUnit: externalModel.packagingCostPerUnit,
      paymentFeePercent: externalModel.paymentFeePercent,
      paymentFeeFixed: externalModel.paymentFeeFixed,
      overheadAllocationPercent: externalModel.overheadAllocationPercent,
      taxRatePercent: externalModel.taxRatePercent,
      minAcceptableMarginPercent: externalModel.minAcceptableMarginPercent,
      maxCostToServePercentOfRevenue: externalModel.maxCostToServePercentOfRevenue,
      currency: externalModel.currency
    };
  }
}

export class CostModelService {
  constructor(
    private readonly financeClient: FinanceClient,
    private readonly localConfigRepo: LocalCostConfigRepository,
    private readonly normalizer: CostModelNormalizer,
    private readonly logger: Logger
  ) {}

  async getNormalizedCostModel(
    shopId: number
  ): Promise<{ model: NormalizedCostModel; version: CostModelVersioning }> {
    try {
      const externalModel = await this.financeClient.getCostModel(shopId);
      if (externalModel) {
        return {
          model: this.normalizer.normalize(shopId, externalModel),
          version: {
            versionId: `finance:${externalModel.updatedAt}`,
            source: 'finance',
            updatedAt: externalModel.updatedAt
          }
        };
      }
    } catch (e) {
      this.logger.warn('Finance module unavailable, using local cost model', { shopId });
    }

    const localModel = await this.localConfigRepo.getCostConfig(shopId);
    const normalized = this.normalizer.normalize(shopId, localModel);

    const now = new Date().toISOString();

    return {
      model: normalized,
      version: {
        versionId: `local:${now}`,
        source: 'local',
        updatedAt: now
      }
    };
  }
}
```

### 2.3 Analytics Core Contract

```typescript
// packages/order-nexus/src/contracts/analytics-contract.ts

export interface OrderAnalyticsEvent {
  shopId: number;
  orderId: string;
  orderDate: string;       // ISO
  revenue: number;
  netProfit: number;
  marginPercent: number;
  profitStatus: ProfitStatus;
  customerProfitTier: string | null;
  channel: string | null;
}
```

### 2.4 WMS Lite & Echo Hub

```typescript
// packages/order-nexus/src/contracts/operations-contract.ts

export interface FulfillmentProfitSignal {
  shopId: number;
  orderId: string;
  priority: 'STANDARD' | 'HIGH_PROFIT' | 'VIP' | 'LOW_MARGIN';
  notes: string[];
  recommendedServiceLevel?: 'ECONOMY' | 'STANDARD' | 'EXPRESS';
}

export interface ProfitTaskPayload {
  shopId: number;
  orderId: string;
  type: 'PROFIT_LEAKAGE_REVIEW' | 'CARRIER_NEGOTIATION' | 'PACKAGING_OPTIMIZATION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedOwner: 'ops' | 'finance' | 'cx';
  expectedImpact: number;
  dueDate: string;
}
```

### 2.5 ReturnNexus → OrderNexus (ReturnOutcomeEvent)

OrderNexus consumes **order-level return impact** from ReturnNexus and persists it separately from the original profitability snapshot.

```typescript
// packages/order-nexus/src/contracts/returns-contract.ts

export interface ReturnOutcomeEvent {
  shopId: number;
  orderId: string;
  returnId: string;

  totalRefundAmount: number;    // total refunded for this return
  totalRestockingCost: number;  // handling / inspection / restocking
  totalWriteOffCost: number;    // scrapped inventory, etc.

  currency: string;
  processedAt: string;          // ISO – when ReturnNexus closed the return
}
```

**Rules:**

* Exactly one ReturnOutcomeEvent per returnId value at a time.
* If a return is adjusted or re-opened, ReturnNexus MUST emit a new ReturnOutcomeEvent with the same returnId and updated totals.
* OrderNexus MUST treat these as append-only events and MUST NOT mutate the canonical order_profitability row.

---

## 3. PCD Hashing – Platform Contract

```typescript
// packages/shared/src/pcd/pcd-hasher.ts

export interface PcdConfig {
  secretSalt: string; // same across modules per environment
  hmacKey: string;    // same across modules per environment
}

export class PcdHasher {
  constructor(private readonly config: PcdConfig) {}

  hashCustomerId(shopId: number, rawCustomerId: string): string {
    const input = `${shopId}:${rawCustomerId}:${this.config.secretSalt}`;
    return crypto
      .createHmac('sha256', this.config.hmacKey)
      .update(input)
      .digest('hex')
      .slice(0, 64);
  }

  verifyHash(shopId: number, rawCustomerId: string, hashedId: string): boolean {
    return this.hashCustomerId(shopId, rawCustomerId) === hashedId;
  }
}
```

**OrderNexus must never invent its own salt.** It injects `PcdHasher` from the shared package.

---

## 4. Profit Policies & CNS Context (LOCKED v1)

OrderNexus NO LONGER owns any concept of:

* `Mode = 'survival' | 'growth' | 'architect'`
* Mode-specific policy maps
* Mode determination based on order volume (or any other heuristic)

All of the following are now INVALID inside OrderNexus and MUST NOT be (re)implemented:

* `ORDER_NEXUS_MODE_POLICIES`
* `ModePolicyManager`
* `determineInitialMode(shopId)`
* `getModeForShop(shopId)`

### 4.1 What OrderNexus Owns

OrderNexus owns ONLY **pure, deterministic** profitability rules:

* Landed cost computation
* Net profit and margin %
* Profit status classification (e.g. `HEALTHY | AT_RISK | UNPROFITABLE`)
* Profit leakage detection (shipping, service level, handling, etc.)
* Historical recomputation and cost-model versioning

These rules may use inputs such as:

* `CostModelSnapshot` (from Financial Intelligence)
* Per-shop config (hard ceilings/floors explicitly stored as config values)

…but they MUST NOT branch on merchant "mode".

### 4.2 What CNS Owns

CNS Core is the *only* source of behavioral context:

* `merchantMaturityMode: 'survival' | 'growth' | 'architect'`
* `revenueBand`
* `burningPriority`
* `timeContext`

CNS + InsightCore then **interpret** OrderNexus output:

* Survival → emphasis on cash risk, red/urgent framing
* Growth → emphasis on leverage & scaling opportunities
* Architect → emphasis on systems, margin optimization, and workflows

OrderNexus emits neutral, mode-agnostic data and signals.  
CNS decides how "loud" that should feel for the merchant.

---

## 6. Fallback Manager – Customer Signals

```typescript
// packages/order-nexus/src/resilience/fallback-manager.ts

export interface CustomerSignalResult {
  signal: SpecterCustomerSignal;
  source: 'specter' | 'fallback' | 'default';
  confidence: number; // 0–1
}

export class FallbackManager {
  constructor(
    private readonly pcdHasher: PcdHasher,
    private readonly moduleRegistry: ModuleRegistry,
    private readonly specterClient: SpecterClient,
    private readonly logger: Logger
  ) {}

  async getCustomerSignal(
    shopId: number,
    rawCustomerId: string
  ): Promise<CustomerSignalResult> {
    const hashedId = this.pcdHasher.hashCustomerId(shopId, rawCustomerId);

    const hasSpecter = await this.moduleRegistry.isInstalled('specter', shopId);
    if (!hasSpecter) {
      return {
        signal: createDefaultCustomerSignal(shopId, hashedId),
        source: 'default',
        confidence: 0.1
      };
    }

    try {
      const signal = await this.specterClient.getCustomerSignal(shopId, hashedId);
      if (signal) {
        return { signal, source: 'specter', confidence: 0.9 };
      }

      const fallback = await this.generateInferredSignal(shopId, hashedId);
      return { signal: fallback, source: 'fallback', confidence: 0.5 };

    } catch (error: any) {
      this.logger.warn('Specter unavailable, using inferred signal', {
        shopId,
        customerId: hashedId,
        error: error.message
      });

      const fallback = await this.generateInferredSignal(shopId, hashedId);
      return { signal: fallback, source: 'fallback', confidence: 0.3 };
    }
  }

  private async generateInferredSignal(
    shopId: number,
    hashedCustomerId: string
  ): Promise<SpecterCustomerSignal> {
    const orderHistory = await this.getCustomerOrderHistory(shopId, hashedCustomerId);
    const base = createDefaultCustomerSignal(shopId, hashedCustomerId);

    return {
      ...base,
      specterCustomerTier: this.inferTierFromHistory(orderHistory),
      predictedLTV: this.estimateLTVFromHistory(orderHistory),
      returnsRisk: this.calculateHistoricalReturnsRisk(orderHistory),
      churnRisk: this.calculateChurnRisk(orderHistory)
    };
  }

  // getCustomerOrderHistory, inferTierFromHistory, etc. are implementation details.
}
```

---

## 7. Module Presence & Capability Flags

```typescript
// packages/order-nexus/src/modules/module-presence.ts

export interface ModulePresence {
  specter: boolean;
  finance: boolean;
  skuOs: boolean;
  wmsLite: boolean;
  echoHub: boolean;
}

export interface CapabilityFlags {
  hasPreciseCostModels: boolean;
  hasCustomerBehaviorData: boolean;
  hasInventoryIntelligence: boolean;
  hasAutomatedFulfillment: boolean;
  hasWorkflowAutomation: boolean;
}

export const CAPABILITY_MATRIX = {
  standalone: {
    trueLandedCost: true,
    profitStatus: true,
    basicLeakageDetection: true,
    simpleWhaleCurve: true,
    modeAwarePolicies: true
  },
  withSpecter: {
    customerProfitabilityTiers: true,
    blendedLTVCalculation: true,
    richCustomerInterventions: true,
    priceSensitivityAwarePricing: true
  },
  withFinance: {
    preciseCostModels: true,
    policyDrivenThresholds: true,
    overheadAllocation: true,
    taxAwareProfitability: true
  },
  withSkuOs: {
    demandAwarePricing: true,
    stockoutRiskAssessment: true,
    inventoryCostOptimization: true
  }
} as const;

export class ModulePresenceManager {
  constructor(private readonly moduleRegistry: ModuleRegistry) {}

  async getModulePresence(shopId: number): Promise<ModulePresence> {
    const [specter, finance, skuOs, wmsLite, echoHub] = await Promise.all([
      this.moduleRegistry.isInstalled('specter', shopId),
      this.moduleRegistry.isInstalled('finance', shopId),
      this.moduleRegistry.isInstalled('sku-os', shopId),
      this.moduleRegistry.isInstalled('wms-lite', shopId),
      this.moduleRegistry.isInstalled('echo-hub', shopId)
    ]);

    return { specter, finance, skuOs, wmsLite, echoHub };
  }

  getCapabilityFlags(presence: ModulePresence): CapabilityFlags {
    return {
      hasPreciseCostModels: presence.finance,
      hasCustomerBehaviorData: presence.specter,
      hasInventoryIntelligence: presence.skuOs,
      hasAutomatedFulfillment: presence.wmsLite,
      hasWorkflowAutomation: presence.echoHub
    };
  }
}
```

---

**End of Document 2: External Contracts & Integration**
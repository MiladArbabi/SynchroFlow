# OrderNexus – Locked Blueprint

**Role:** Profit-First Order Intelligence Module  
**Job:** *Single source of truth for order-level profitability and leakage*

---

## 0. Responsibility & Boundaries

### 0.1 Mission

> **OrderNexus Mission:** Be the canonical source for **order-level profitability**, **profit leakage detection**, and **order-centric customer profitability** inside LaSyncro.

### 0.2 Owns vs Not Owns

**OrderNexus OWNS:**

* True landed cost per order
* Net profit & margin %
* Order-level profit status: `HEALTHY | AT_RISK | UNPROFITABLE`
* Profit leakage classification per order
* Customer profitability tiers **from realized orders** (whale curve)
* Basic profit interventions (suggestions, not execution)

OrderNexus OWNS `returns_rate_30d`:

* It computes `returns_rate_30d` per product using:
  * Order history, and
  * ReturnOutcomeEvent / ReturnAnalyticsEvent from ReturnNexus.
* It exposes this as part of `product_demand_signals` (or a compatible view).
* SKU OS MUST NOT recompute returns rate; it only consumes `returns_rate_30d`.

**OrderNexus DOES NOT OWN:**

* Customer behavior & LTV models → **Specter**
* SKU-level stock & replenishment → **SKU OS**
* Cash flow, P&L, forecasting → **Financial Intelligence**
* Fulfillment routing & warehouse ops → **WMS Lite**
* Task workflows & approvals → **Echo Hub**
* Global dashboards & cross-module charts → **Analytics Core**
* Return case lifecycle, refund / exchange decisions → **ReturnNexus**

## 0.3 CNS Integration (LOCKED v1)

 OrderNexus does NOT own merchant mode, behavior mode selection, or UX emphasis.
 These are exclusively produced by the CNS Core (Central Nervous System).

 OrderNexus MUST:

* Compute order profitability deterministically.
* Emit OrderNexusSignal → CNS (profit stability, leakage, trends).
* Consume CnsContextSnapshot only for **interpretation**, NEVER computation.

 OrderNexus MUST NOT:

* Predict or assign merchant modes.
* Store mode-related fields.
* Alter profitability thresholds based on mode.

 CNS Core is the ONLY source of:

* mode: 'survival' | 'growth' | 'architect'
* revenueBand
* burningPriority
* UI timeContext

 OrderNexus remains *mathematically stable*, CNS handles interpretation.

---

## 1. Core Types – The Canonical Model

### 1.1 Profit & Cost Types

```typescript
// packages/order-nexus/src/types/core-types.ts

export type ProfitStatus = 'HEALTHY' | 'AT_RISK' | 'UNPROFITABLE';

export type ComputationSourceReason =
  | 'initial'
  | 'recomputation'
  | 'basic_fallback';

export type CostModelSource = 'finance' | 'local';

export interface ModePolicies {
  minMarginPercent: number;
  allowUnprofitableOrders: boolean;
  requireApprovalBelowMargin: boolean;
  leakageAlertThreshold: number;
  automatedInterventions: string[];
  maxCustomerAcquisitionCost: number;
}

export interface LandedCost {
  cogs: number;
  shipping: number;
  handling: number;
  packaging: number;
  paymentFees: number;
  overhead: number;
  total: number;
  currency: string;
}

export interface OrderProfitability {
  orderId: string;
  shopId: number;
  revenue: number;
  landedCost: LandedCost;
  netProfit: number;
  marginPercent: number;
  profitStatus: ProfitStatus;
  leakage: LeakageDetection[];
  calculatedAt: Date;

  // Versioning / audit
  costModelVersion: string;
  costModelSource: CostModelSource;           // 'finance' | 'local'
  computationSource: ComputationSourceReason; // 'initial' | 'recomputation' | 'basic_fallback'

  // For recomputations
  previousNetProfit?: number;
  previousCostModelVersion?: string;
}
```

### 1.2 NormalizedOrder – The Only Order Type Engines See

```typescript
// packages/order-nexus/src/types/core-types.ts

export interface NormalizedOrder {
  id: string;
  shopId: number;

  // Time – Phase 1: all time series use createdAt
  createdAt: string;    // Shopify 'created_at' (UTC)
  updatedAt: string;    // Shopify 'updated_at'
  processedAt?: string; // Shopify 'processed_at' if present

  // Monetary
  currency: string;
  totalPrice: number;    // total_price
  subtotalPrice: number; // subtotal_price
  totalTax: number;      // total_tax

  // Shipping lines
  shippingLines: Array<{
    price: number; // parsed price
    title: string;
    code?: string;
  }>;

  // Line items
  lineItems: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price: number;  // item price
    cogs?: number;  // optional, from SKU OS later
  }>;

  // PCD-compliant customer
  customer?: {
    hashedId: string; // from shared PcdHasher
  };
}
```

### 1.3 Profit Interventions & Leakage

```typescript
// packages/order-nexus/src/types/profit-types.ts

export type ProfitInterventionType =
  | 'MARGIN_PROTECTION'
  | 'CUSTOMER_TERMS_ADJUSTMENT'
  | 'SUGGEST_REVIEW'
  | 'SHIPPING_OPTIMIZATION'
  | 'SERVICE_LEVEL_ADJUSTMENT';

export interface ProfitIntervention {
  type: ProfitInterventionType;
  action: string;         // e.g. 'REMOVE_FREE_SHIPPING'
  reason: string;         // human-readable explanation
  expectedImpact: number; // monetary impact in shop currency
  confidence?: number;    // 0–1
  requiresApproval: boolean;
}

export type LeakageType =
  | 'SHIPPING_INEFFICIENCY'
  | 'SERVICE_OVERKILL'
  | 'RETURNS_RISK'
  | 'PAYMENT_FEES_HIGH'
  | 'PACKAGING_OVERKILL';

export interface LeakageDetection {
  type: LeakageType;
  amount: number; // leakage amount
  reason: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}
```

### 1.4 Customer Profit Context

```typescript
// packages/order-nexus/src/types/profit-types.ts

export interface CustomerProfitContext {
  tier: string;               // 'VIP' | 'CORE' | etc.
  predictedLTV: number;
  churnRisk: number;          // 0–1
  priceSensitivity: number;   // 0–1
  returnsRisk: number;        // 0–1
  source: 'specter' | 'fallback' | 'default';
  confidence: number;         // 0–1
}
```

Centralized mapper:

```typescript
// packages/order-nexus/src/mappers/customer-signal-mapper.ts

export class CustomerSignalMapper {
  static toCustomerProfitContext(
    result: CustomerSignalResult
  ): CustomerProfitContext {
    return {
      tier: result.signal.specterCustomerTier,
      predictedLTV: result.signal.predictedLTV,
      churnRisk: result.signal.churnRisk,
      priceSensitivity: result.signal.priceSensitivity,
      returnsRisk: result.signal.returnsRisk,
      source: result.source,
      confidence: result.confidence
    };
  }
}
```

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

…but they MUST NOT branch on merchant “mode”.

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
CNS decides how “loud” that should feel for the merchant.

---

## 5. Normalization Boundary – No Raw Shopify Beyond This

```typescript
// packages/order-nexus/src/normalization/order-normalization-service.ts

export class OrderNormalizationService {
  constructor(private readonly pcdHasher: PcdHasher) {}

  normalizeShopifyOrder(rawOrder: any): NormalizedOrder {
    const shopId = Number(rawOrder.shop_id);

    return {
      id: String(rawOrder.id),
      shopId,
      createdAt: rawOrder.created_at,
      updatedAt: rawOrder.updated_at,
      processedAt: rawOrder.processed_at || undefined,
      currency: rawOrder.currency,
      totalPrice: parseFloat(rawOrder.total_price),
      subtotalPrice: parseFloat(rawOrder.subtotal_price),
      totalTax: parseFloat(rawOrder.total_tax || '0'),
      shippingLines: (rawOrder.shipping_lines || []).map((line: any) => ({
        price: parseFloat(line.price),
        title: line.title,
        code: line.code
      })),
      lineItems: (rawOrder.line_items || []).map((item: any) => ({
        productId: String(item.product_id),
        variantId: item.variant_id ? String(item.variant_id) : undefined,
        quantity: item.quantity,
        price: parseFloat(item.price)
      })),
      customer: rawOrder.customer
        ? {
            hashedId: this.pcdHasher.hashCustomerId(
              shopId,
              String(rawOrder.customer.id)
            )
          }
        : undefined
    };
  }
}
```

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

## 8. CoreProfitEngine – Mathematically Correct

```typescript
// packages/order-nexus/src/core/profit-engine.ts

export class CoreProfitEngine {
  constructor(
    private readonly costModelService: CostModelService,
    private readonly modePolicyManager: ModePolicyManager
  ) {}

  async calculateOrderProfitability(
    order: NormalizedOrder,
    isRecomputation: boolean = false
  ): Promise<OrderProfitability> {
    const { model: costModel, version: costVersion } =
      await this.costModelService.getNormalizedCostModel(order.shopId);

    const landedCost = this.calculatePreciseLandedCost(order, costModel);
    const netProfit = order.totalPrice - landedCost.total;
    const marginPercent = (netProfit / order.totalPrice) * 100;

    const policies = await this.modePolicyManager.getPoliciesForShop(order.shopId);

    let computationSource: ComputationSourceReason;
    if (isRecomputation) computationSource = 'recomputation';
    else if (costVersion.source === 'local') computationSource = 'basic_fallback';
    else computationSource = 'initial';

    return {
      orderId: order.id,
      shopId: order.shopId,
      revenue: order.totalPrice,
      landedCost,
      netProfit,
      marginPercent,
      profitStatus: this.determineProfitStatus(netProfit, marginPercent, policies),
      leakage: this.detectBasicLeakage(order, landedCost, policies),
      calculatedAt: new Date(),
      costModelVersion: costVersion.versionId,
      costModelSource: costVersion.source,
      computationSource
    };
  }

  private calculatePreciseLandedCost(
    order: NormalizedOrder,
    costModel: NormalizedCostModel
  ): LandedCost {
    const cogs = this.estimateCOGS(order.lineItems);
    const shipping = this.calculateActualShipping(order);
    const handling = costModel.handlingCostPerOrder;
    const packaging = order.lineItems.reduce(
      (sum, item) => sum + item.quantity * costModel.packagingCostPerUnit,
      0
    );
    const paymentFees =
      order.totalPrice * (costModel.paymentFeePercent / 100) +
      costModel.paymentFeeFixed;
    const overhead =
      order.totalPrice * (costModel.overheadAllocationPercent / 100);

    const total = cogs + shipping + handling + packaging + paymentFees + overhead;

    return {
      cogs,
      shipping,
      handling,
      packaging,
      paymentFees,
      overhead,
      total,
      currency: costModel.currency
    };
  }

  private calculateActualShipping(order: NormalizedOrder): number {
    if (!order.shippingLines || order.shippingLines.length === 0) return 0;
    return order.shippingLines.reduce((sum, line) => sum + line.price, 0);
  }

  private determineProfitStatus(
    netProfit: number,
    marginPercent: number,
    policies: ModePolicies
  ): ProfitStatus {
    if (netProfit < 0) return 'UNPROFITABLE';
    if (marginPercent < policies.minMarginPercent) return 'AT_RISK';
    return 'HEALTHY';
  }

  private detectBasicLeakage(
    order: NormalizedOrder,
    cost: LandedCost,
    policies: ModePolicies
  ): LeakageDetection[] {
    const leakages: LeakageDetection[] = [];

    // Example: shipping inefficiency
    if (cost.shipping > order.totalPrice * 0.15) {
      leakages.push({
        type: 'SHIPPING_INEFFICIENCY',
        amount: cost.shipping - order.totalPrice * 0.1,
        reason: 'Shipping cost exceeds 15% of order value',
        severity: cost.shipping > policies.leakageAlertThreshold ? 'HIGH' : 'MEDIUM'
      });
    }

    return leakages;
  }

  private estimateCOGS(lineItems: NormalizedOrder['lineItems']): number {
    // Phase 1: simple placeholder (can be refined with SKU OS integration later)
    return lineItems.reduce((sum, item) => {
      const assumedCost = item.cogs ?? item.price * 0.5; // assume 50% margin if unknown
      return sum + assumedCost * item.quantity;
    }, 0);
  }
}
```

---

## 9. MarginGuardEngine – Confidence & Mode Rules

```typescript
// packages/order-nexus/src/intelligence/margin-guard-engine.ts

/**
 * CONFIDENCE RULES:
 *
 * - Customer-tier interventions require:
 *   - hasCustomerBehaviorData = true (Specter installed)
 *   - confidence > 0.5
 *
 * - Aggressive interventions (Architect mode) require:
 *   - confidence > 0.7
 *   - mode = 'architect'
 *
 * - If confidence <= 0.5:
 *   - Skip customer-specific logic; apply only generic margin protection.
 */
export class MarginGuardEngine {
  constructor(
    private readonly modePolicyManager: ModePolicyManager,
    private readonly logger: Logger
  ) {}

  async generateInterventions(
    profitability: OrderProfitability,
    customerContext: CustomerProfitContext,
    capabilities: CapabilityFlags
  ): Promise<ProfitIntervention[]> {
    const interventions: ProfitIntervention[] = [];
    const policies = await this.modePolicyManager.getPoliciesForShop(profitability.shopId);

    // 1. Always: basic margin protection based on ModePolicies
    if (profitability.marginPercent < policies.minMarginPercent) {
      interventions.push({
        type: 'MARGIN_PROTECTION',
        action: 'SUGGEST_UPSELL',
        reason: 'Margin below mode-specific threshold',
        expectedImpact: Math.abs(profitability.netProfit) * 0.2,
        requiresApproval: false
      });
    }

    // 2. Customer-tier interventions – only with Specter & sufficient confidence
    if (!capabilities.hasCustomerBehaviorData) return interventions;

    if (customerContext.confidence <= 0.5) {
      this.logger.debug('Skipping customer-tier interventions due to low confidence', {
        orderId: profitability.orderId,
        confidence: customerContext.confidence
      });
      return interventions;
    }

    interventions.push(
      ...(await this.generateCustomerTierInterventions(
        profitability,
        customerContext
      ))
    );

    return interventions;
  }

  private async generateCustomerTierInterventions(
    profitability: OrderProfitability,
    customerContext: CustomerProfitContext
  ): Promise<ProfitIntervention[]> {
    const interventions: ProfitIntervention[] = [];
    const mode = await this.modePolicyManager.getModeForShop(profitability.shopId);

    if (customerContext.tier === 'RISKY' && profitability.marginPercent < 10) {
      const impact = Math.abs(profitability.netProfit) * 0.2;

      if (mode === 'architect' && customerContext.confidence > 0.7) {
        interventions.push({
          type: 'CUSTOMER_TERMS_ADJUSTMENT',
          action: 'REMOVE_FREE_SHIPPING',
          reason: 'High-risk customer with low-margin order',
          expectedImpact: impact,
          confidence: customerContext.confidence,
          requiresApproval: false
        });
      } else {
        interventions.push({
          type: 'SUGGEST_REVIEW',
          action: 'FLAG_FOR_MANUAL_REVIEW',
          reason: `Potential high-risk customer (confidence: ${customerContext.confidence})`,
          expectedImpact: impact,
          confidence: customerContext.confidence,
          requiresApproval: true
        });
      }
    }

    return interventions;
  }
}
```

---

## 10. Data Model – SQL Schema (Phase 1)

```sql
-- Core profitability snapshot
CREATE TABLE order_profitability (
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,

  -- Maps to Shopify 'created_at' (UTC)
  order_date TIMESTAMPTZ NOT NULL,

  -- Core metrics
  revenue_total DECIMAL(10,2) NOT NULL,
  landed_cost_total DECIMAL(10,2) NOT NULL,
  net_profit DECIMAL(10,2) NOT NULL,
  margin_percent DECIMAL(5,2) NOT NULL,
  profit_status VARCHAR(16) NOT NULL,

  -- Leakage (aggregated + detail)
  leakage_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  leakage_categories JSONB,

  -- Versioning / audit
  cost_model_version VARCHAR(64) NOT NULL,
  cost_model_source VARCHAR(16) NOT NULL, -- 'finance' | 'local'
  computation_source VARCHAR(32) NOT NULL DEFAULT 'initial',
  previous_net_profit DECIMAL(10,2),
  previous_cost_model_version VARCHAR(64),

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (shop_id, order_id)
);

COMMENT ON COLUMN order_profitability.order_date IS
  'Source: Shopify created_at (UTC). Used for time-series profitability reporting.';

CREATE INDEX idx_order_profitability_shop_status
  ON order_profitability(shop_id, profit_status);

CREATE INDEX idx_order_profitability_shop_date
  ON order_profitability(shop_id, order_date);

-- History table (recomputations)
CREATE TABLE order_profitability_history (
  id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  cost_model_version VARCHAR(64) NOT NULL,
  net_profit DECIMAL(10,2) NOT NULL,
  computation_source VARCHAR(32) NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_profit_history_order
  ON order_profitability_history(shop_id, order_id);

CREATE INDEX idx_order_profit_history_version
  ON order_profitability_history(cost_model_version);

CREATE TABLE order_return_impact (
  id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  return_id VARCHAR(64) NOT NULL,

  total_refund_amount DECIMAL(10,2) NOT NULL,
  total_restocking_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_writeoff_cost DECIMAL(10,2) NOT NULL DEFAULT 0,

  currency VARCHAR(8) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,       -- from ReturnOutcomeEvent.processedAt
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_return_impact_order
  ON order_return_impact (shop_id, order_id);

CREATE INDEX idx_order_return_impact_return
  ON order_return_impact (shop_id, return_id);
```

---

## 11. Repositories & Recomputation Flow

```typescript
// packages/order-nexus/src/repositories/order-profit-repositories.ts

export interface OrderProfitabilityRepository {
  getOrderProfitability(shopId: number, orderId: string): Promise<OrderProfitability | null>;
  saveOrderProfitability(profit: OrderProfitability): Promise<void>;
}

export interface OrderProfitHistoryRecord {
  shopId: number;
  orderId: string;
  costModelVersion: string;
  netProfit: number;
  computationSource: ComputationSourceReason;
  calculatedAt: Date;
}

export interface OrderProfitHistoryRepository {
  save(record: OrderProfitHistoryRecord): Promise<void>;
  getOrderHistory(shopId: number, orderId: string): Promise<OrderProfitHistoryRecord[]>;
}

export interface OrderReturnImpactRecord {
  shopId: number;
  orderId: string;
  returnId: string;
  totalRefundAmount: number;
  totalRestockingCost: number;
  totalWriteOffCost: number;
  currency: string;
  processedAt: Date;
}

export interface OrderReturnImpactRepository {
  upsertImpact(record: OrderReturnImpactRecord): Promise<void>;
  listImpactsForOrder(shopId: number, orderId: string): Promise<OrderReturnImpactRecord[]>;
}
```

```typescript
// packages/order-nexus/src/services/order-profit-service.ts

export class OrderProfitService {
  constructor(
    private readonly profitRepo: OrderProfitabilityRepository,
    private readonly profitHistoryRepo: OrderProfitHistoryRepository,
    private readonly profitEngine: CoreProfitEngine,
    private readonly orderRepo: NormalizedOrderRepository
  ) {}

  async computeInitialProfit(order: NormalizedOrder): Promise<OrderProfitability> {
    const result = await this.profitEngine.calculateOrderProfitability(order, false);
    await this.profitRepo.saveOrderProfitability(result);
    return result;
  }

  async recomputeOrderProfitability(
    shopId: number,
    orderId: string,
    reason: string
  ): Promise<OrderProfitability> {
    const previous = await this.profitRepo.getOrderProfitability(shopId, orderId);
    const order = await this.orderRepo.getNormalizedOrder(shopId, orderId);

    if (!order) {
      throw new Error(`Cannot recompute profitability: order ${orderId} not found for shop ${shopId}`);
    }

    if (!previous) {
      const initial = await this.profitEngine.calculateOrderProfitability(order, false);
      await this.profitRepo.saveOrderProfitability(initial);
      return initial;
    }

    await this.profitHistoryRepo.save({
      shopId: previous.shopId,
      orderId: previous.orderId,
      costModelVersion: previous.costModelVersion,
      netProfit: previous.netProfit,
      computationSource: previous.computationSource,
      calculatedAt: previous.calculatedAt
    });

    const recomputed = await this.profitEngine.calculateOrderProfitability(order, true);
    recomputed.previousNetProfit = previous.netProfit;
    recomputed.previousCostModelVersion = previous.costModelVersion;

    await this.profitRepo.saveOrderProfitability(recomputed);

    return recomputed;
  }
}
```

---

## 12. Ingestion Pipeline & SLA

### 12.1 Queue Message & Worker

```typescript
// packages/order-nexus/src/ingestion/order-ingestion-queue.ts

import { NormalizedOrder } from '../types/core-types';

export interface OrderQueueMessage {
  shopId: number;
  orderId: string;
  order: NormalizedOrder;
  topic: string; // 'orders/create', 'orders/updated', etc.
}

export interface OrderIngestionQueue {
  enqueue(msg: OrderQueueMessage): Promise<void>;
}
```

```typescript
// packages/order-nexus/src/metrics/metrics-client.ts

export interface MetricsClient {
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void;
  incrementCounter(name: string, tags?: Record<string, string>): void;
}
```

```typescript
// packages/order-nexus/src/operations/sla-monitor.ts

export interface SLASpec {
  targetProcessingTime: number;
  warningThreshold: number;
  maxExpectedTime: number;
  successRateTarget: number;
  availabilityTarget: number;
}

export class OrderProcessingSLA {
  private readonly TARGET_PROCESSING_TIME_MS = 5000;
  private readonly WARNING_THRESHOLD_MS = 25000;
  private readonly MAX_EXPECTED_TIME_MS = 60000;

  constructor(private readonly metrics: MetricsClient) {}

  async processOrderWithSLA(
    handler: () => Promise<void>,
    msg: OrderQueueMessage
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await handler();
      const processingTime = Date.now() - startTime;

      this.metrics.recordHistogram('order_processing_time_ms', processingTime, {
        shopId: String(msg.shopId)
      });

      if (processingTime > this.TARGET_PROCESSING_TIME_MS) {
        this.metrics.incrementCounter('order_processing_time_exceeded', {
          shopId: String(msg.shopId)
        });
      }

      if (processingTime > this.WARNING_THRESHOLD_MS) {
        this.metrics.incrementCounter('order_processing_delay_warning', {
          shopId: String(msg.shopId)
        });
      }
    } catch (error: any) {
      this.metrics.incrementCounter('order_processing_error', {
        shopId: String(msg.shopId),
        error: error?.name || 'unknown'
      });
      throw error;
    }
  }

  getSLASpecification(): SLASpec {
    return {
      targetProcessingTime: this.TARGET_PROCESSING_TIME_MS,
      warningThreshold: this.WARNING_THRESHOLD_MS,
      maxExpectedTime: this.MAX_EXPECTED_TIME_MS,
      successRateTarget: 0.99,
      availabilityTarget: 0.995
    };
  }
}
```

```typescript
// packages/order-nexus/src/ingestion/order-worker.ts

export class OrderWorker {
  constructor(
    private readonly profitService: OrderProfitService,
    private readonly slaMonitor: OrderProcessingSLA
  ) {}

  async handleMessage(msg: OrderQueueMessage): Promise<void> {
    await this.slaMonitor.processOrderWithSLA(
      async () => {
        await this.profitService.computeInitialProfit(msg.order);
      },
      msg
    );
  }
}
```

---

## 13. Developer Contract – Final Locked Statement

> **OrderNexus Developer Contract**
>
> Given Shopify orders (via webhooks or backfill) and a basic cost configuration, **OrderNexus guarantees**:
>
> * Computation of **true landed cost**, **net profit**, **margin %**, and **profit status** for every ingested order.
> * **Basic profit leakage detection** (shipping + service overkill at minimum).
> * **Customer profitability tiers** derived from realized order history (whale curve) when Specter is available.
> * **Graceful degradation**:
>   * If Financial Intelligence is unavailable → falls back to local cost models (`costModelSource = 'local'`, `computationSource = 'basic_fallback'`).
>   * If Specter is unavailable → uses inferred/default customer signals with explicit confidence.
> * **Operational SLA**:
>   * Target processing time: **5 seconds** per order under normal load.
>   * 99% of orders have profit data within **60 seconds** of webhook receipt.
>   * Queue delay warnings emitted after **25 seconds**.
> * **Auditability**:
>   * All recomputations tracked with:
>     * previous net profit
>     * previous cost model version
>     * history entries in `order_profitability_history`.
>   * Cost model sources (`finance` vs `local`) and computation reasons (`initial`, `recomputation`, `basic_fallback`) are explicitly stored and queryable.
>   * Post-return economic impact is stored separately in `order_return_impact`, sourced exclusively from `ReturnOutcomeEvent` emitted by ReturnNexus.

### 13.1 CNS & Mode Boundary (LOCKED)

OrderNexus MUST:

* Remain **mode-agnostic**: no internal `survival | growth | architect` branching.
* Produce consistent profitability outputs for the same inputs, regardless of CNS state.
* Expose signals and metrics that CNS can consume (profit stability, leakage, trend scores).

OrderNexus MUST NOT:

* Store or compute merchant maturity mode.
* Change thresholds based on mode or psychological framing.
* Own any UX, urgency, or “tone” decisions.

All behavioral variation (Survival vs Growth vs Architect) is handled by:

* **CNS Core** → generates `CnsContextSnapshot`
* **InsightCore & Widgets** → render context-aware UI using that snapshot

---

## 14. Onboarding & Readiness – OrderNexus (Draft)

**Goal:** Define exactly when a shop is considered OrderNexusReady, what must be true in the data plane and config plane, and how this maps to onboarding tasks surfaced in FT0 flows.

### 14.1 Role in FT0 & LaSyncro

OrderNexus is the economic backbone of LaSyncro:

It converts raw orders → normalized orders → profitability snapshots.

It feeds:

* InsightCore (analytics events, whale curves, profitability distributions),
* Specter (profit-aware customer tiers, interventions),
* ReturnNexus (post-return economics via order_return_impact),
* MarginCore / Finance (cost model usage + feedback loops),
* Echo Hub / WMS Lite (fulfilment profit signals, tasks).

Therefore, FT0 onboarding MUST guarantee that OrderNexus is healthy before higher-order intelligence (Specter, InsightCore, ReturnNexus dashboards) is considered "ready".

### 14.2 Readiness Definition

We define a concrete boolean:

```typescript
// Conceptual contract – not implementation detail
type OrderNexusReadinessFlag =
  | 'MISSING_SHOPIFY_INTEGRATION'
  | 'NO_ORDERS_INGESTED'
  | 'COST_MODEL_FALLBACK_ACTIVE'
  | 'COST_MODEL_PRECISE'
  | 'MODE_AUTODETECTED'
  | 'MODE_EXPLICITLY_SET'
  | 'PIPELINE_HEALTHY';

export interface OrderNexusReadinessSnapshot {
  shopId: number;
  isReady: boolean;
  flags: OrderNexusReadinessFlag[];
  lastEvaluatedAt: string; // ISO
}
```

`OrderNexusReady(shopId)` is **true** when **ALL** of the following hold:

1. **Shopify integration exists and initial sync is completed**
   * `platform.integration.connected === true`
   * `platform.integration.syncCompleted === true`

2. **At least one profitable order has been processed**
   * `orderNexus.profitabilityActive === true`
   * `orderNexus.ordersIngested >= 1` (backed by `order_profitability` rows)

3. **Cost model is hydrated (local or finance-driven)**
   * `orderNexus.costModelHydrated === true`
   * `orderNexus.costModelSource` is:
     * `'finance'` → precise cost model (preferred), or
     * `'local'` → fallback allowed, but flagged via readiness flags / UI.

4. **Operating mode is determined**
   * `orderNexus.modeDetermined === true`
   * Mode may be auto-detected or explicitly set by the merchant.

5. **Pipeline is healthy enough for FT0**
   * `orderNexus.pipelineHealthy === true`
   * Backed by `OrderProcessingSLA` metrics (99% of orders processed < `MAX_EXPECTED_TIME_MS`).

6. **Cost confidence is above a minimum floor**
   * `orderNexus.costConfidenceScore >= 0.2`
   * Below this, insights are considered too noisy to treat the module as fully “ready”.

If any of 1–4 fails, `OrderNexusReady = false`.

If 5 is degraded but not catastrophically broken, `OrderNexusReady` may remain `true` but surfaced with **pipeline health warnings**.

Cost model **source** (`finance` vs `local`) influences nudging and labels, but **does not alone block** readiness as long as `orderNexus.costModelHydrated === true` and `orderNexus.costConfidenceScore >= 0.2`.

### 14.3 Merchant-Facing Onboarding Tasks (What the FT0 UX Should Drive)

From the merchant's perspective, OrderNexus onboarding should feel like:

1. **Connect your store** (prerequisite for everything)
   * Task: "Connect your Shopify store"
   * Completes when:
     * Integration is installed and initial sync is COMPLETED.
     * System: `IntegrationContext.hasIntegrations === true` and `syncStatus === 'COMPLETED'`.
2. **Let us compute your first profitability snapshot**
   * Task: "Let us process your first orders"
   * Completes when:
     * `order_profitability` table has ≥ 1 row for shop.
     * UX: show a checkmark and link like "View profitability for recent orders".
3. **Calibrate your cost model** (optional but recommended)
   * Task: "Calibrate your cost model for landed cost"
   * States:
     * Pending (fallback only):
       * `costModelSource === 'local'` and no external Finance config exists.
     * Completed (precise):
       * `costModelSource === 'finance'` from CostModelService.
   * Merchant action:
     * Either configure Finance module (global cost model), or update local cost config in a simple UI (handling cost, packaging, etc.).
   * This is **NOT** a hard blocker for `OrderNexusReady`, but:
     * FT0 should nudge strongly to move from `COST_MODEL_FALLBACK_ACTIVE` → `COST_MODEL_PRECISE`.

## 4. CNS-Driven Interpretation Contract (LOCKED)

 Profitability computation inside OrderNexus is PURE and CANNOT depend on merchant mode.
 However, **INSIGHT INTERPRETATION** depends on CNS context via InsightCore.

### OrderNexus → CNS (signals)

 OrderNexus MUST emit:
 {
   profitStabilityScore: number,     // 0–1
   leakageSeverityScore: number,     // 0–1
   fulfillmentCostVolatility: number,// 0–1
   revenueTrendScore: number         // 0–1
 }

### CNS → InsightCore → Widgets (interpretation)

 Survival Mode:
   • leakageSeverityScore drives CRITICAL urgency

 Growth Mode:
   • leakageSeverityScore drives OPPORTUNITY framing

 Architect Mode:
   • leakageSeverityScore drives SYSTEM OPTIMIZATION insights

 OrderNexus MUST NOT implement these differences internally.
 Only InsightCore may render mode-aware interpretations.

### 14.4 Platform-Level Preconditions (Invisible to Merchant, Critical to Readiness)

The following must be true at the platform level; they are not surfaced as user tasks, but the system should refuse to mark OrderNexus as ready if they're broken:

* **Schemas applied**
  * `order_profitability`, `order_profitability_history`, `order_return_impact` tables exist and migrations have been applied successfully.
* **PCD hashing configuration injected**
  * `PcdHasher` uses shared `PcdConfig` (salt + hmacKey)
  * No module-specific salting or hashing.
* **Ingestion queue wiring valid**
  * An `OrderIngestionQueue` implementation is bound and:
    * Receives messages from Shopify connectors (or backfill jobs) with topic and NormalizedOrder.
    * `OrderWorker.handleMessage` is actually running in the worker process.
* **Metrics pipeline wired**
  * `MetricsClient` is bound; `OrderProcessingSLA` is recording histograms + counters.
  * Even if metrics backend is "no-op" locally, the calls must not throw.
* **ReturnOutcomeEvent consumer bound** (for post-return readiness later)
  * There must be a consumer listening for `ReturnOutcomeEvent` and writing to `order_return_impact`.
  * This is **not** required for base FT0 readiness, but is required before we say "post-return economics are live".

### 14.5 Degradation & Soft-Readiness Rules

OrderNexus is intentionally designed to degrade gracefully:

* **Finance module missing / down:**
  * `CostModelService` falls back to local cost configs.
  * Onboarding flags: `COST_MODEL_FALLBACK_ACTIVE` present.
  * `isReady` may still be true, but certain insights are marked as "approximate".
* **Specter missing / down:**
  * `FallbackManager` uses inferred/default customer signals.
  * `OrderNexusReady` does **not** depend on Specter, but:
    * UI must **NOT** show "customer tier interventions" tasks as part of base FT0 onboarding.
    * Those become add-on onboarding tasks only if Specter is installed.
* **Echo Hub / WMS Lite / SKU-OS missing:**
  * Capability flags in `ModulePresenceManager` will be false.
  * OrderNexus still computes profitability; it just doesn't drive certain operational interventions.

**Rule:** `OrderNexusReady` is fundamentally about per-order profitability & basic leakage, not about every optional integration being present.

### 14.6 Suggested "OrderNexus Onboarding Checklist" (for the TaskList Tracker)

These are the tasks surfaced under an **“Orders & Profitability (OrderNexus)”** section.  
**Store connection** lives under the **Platform** section and is not duplicated here.

1. **Review your first Profit Autopsy**  
   * Task id: `orderNexus.reviewProfitAutopsy`  
   * Goal: Make the merchant **see** true profit vs revenue on at least one order.  
   * Completion rule:
     * `orderNexus.profitabilityActive === true`  
   * CTA: Navigate to the orders view / Profit Autopsy surface.

2. **Fix missing costs so your profit is real**  
   * Task id: `orderNexus.resolveMissingCosts`  
   * Goal: Drive the merchant to clean up COGS gaps that make profit misleading.  
   * Completion rule:
     * `orderNexus.missingCostCount === 0`  
   * CTA: Navigate to a “Missing COGS” / SKU cost configuration view (owned by SKU-OS / cost settings).

3. **Check your Bleed Feed (unprofitable orders)** *(optional but strongly recommended)*  
   * Task id: `orderNexus.checkBleedFeed`  
   * Goal: Show the merchant where they are **actively losing money**.  
   * Completion rule:
     * `orderNexus.hasNegativeMarginOrder === true`  
   * CTA: Navigate to the Bleed Feed orders view.

4. **Confirm your operating mode (Survival / Growth / Architect)**  
   * Task id: `orderNexus.confirmMode`  
   * Goal: Get an explicit mode choice to drive thresholds and framing elsewhere in CNS.  
   * Completion rule:
     * `orderNexus.modeDetermined === true`  
   * CTA: Open mode selection modal / settings.

From an FT0 onboarding perspective:

* Platform section tasks ensure **store connection + sync**.
* OrderNexus section tasks ensure:
  * Profit engine is actually running (`reviewProfitAutopsy`),
  * Data is trustworthy (`resolveMissingCosts`),
  * The merchant has seen their loss-making orders (`checkBleedFeed`),
  * CNS mode is initialized (`confirmMode`).

### 14.7 Signals exposed to the Onboarding Engine (OrderNexus)

For the global `ModuleOnboardingReadiness` engine, OrderNexus exposes the following **locked signal set**:

* `orderNexus.profitabilityActive: boolean`  
  * `true` if `order_profitability` has ≥ 1 row for this shop.

* `orderNexus.ordersIngested: number`  
  * Backed by `COUNT(*) FROM order_profitability WHERE shop_id = :shopId`.
  * Used for:
    * `ordersIngested >= 1` → “Engine activated”
    * Higher thresholds (e.g. `>= 20`) can be used by analytics, but are not part of FT0 readiness.

* `orderNexus.costModelSource: 'finance' | 'local'`  
  * Derived from `CostModelService.getNormalizedCostModel(...)`.
  * Onboarding uses:
    * `costModelSource === 'finance'` → “Cost model calibrated (precise)”
    * `costModelSource === 'local'` → “Using fallback assumptions”

* `orderNexus.costModelHydrated: boolean`  
  * `true` if a usable cost model (finance or local) is available.

* `orderNexus.modeDetermined: boolean`  
  * `true` if `ModePolicyManager.getModeForShop(shopId)` returns a valid mode (auto or explicit).

* `orderNexus.missingCostCount: number`  
  * Number of SKUs / lines with missing COGS that affect recent profitability snapshots.

* `orderNexus.hasNegativeMarginOrder: boolean`  
  * `true` if there exists at least one `net_profit < 0` order in the recent window.

* `orderNexus.pipelineHealthy: boolean`  
  * Derived from `OrderProcessingSLA` metrics. Reflects whether ingestion + profitability computation are within expected SLAs.

* `orderNexus.costConfidenceScore: number` (0–1)  
  * Aggregated confidence over cost data quality (COGS completeness, override frequency, volatility).

Free tier / entitlement signals (defined in the global FTEP contract):

* `order-nexus.freeTierState: ModuleAccessState`
* `order-nexus.freeTierRemaining: number | null`

For FT0, `OrderNexusReady(shopId)` is **true** when:

* `platform.integration.connected === true`
* `platform.integration.syncCompleted === true`
* `orderNexus.profitabilityActive === true`
* `orderNexus.ordersIngested >= 1`
* `orderNexus.costModelHydrated === true`
* `orderNexus.modeDetermined === true`
* `orderNexus.pipelineHealthy === true`
* `orderNexus.costConfidenceScore >= 0.2`

Cost model **source** (`finance` vs `local`) and `missingCostCount` drive **nudges and tasks**, not the ready/not-ready gate.

### 14.8 Mapping to OnboardingTaskListTracker

In the global OnboardingTaskListTracker, OrderNexus appears as:

**Group:** “Orders & Profitability”

**Tasks:**

1. “Connect your Shopify store”  
   * Driven by IntegrationContext (not owned by OrderNexus).

2. “Let us process your first orders”  
   * Complete when `orderNexus.profitabilityActive === true`.

3. “Calibrate your cost model” (recommended)  
   * Complete when `orderNexus.costModelSource === 'finance'`.

4. “Confirm your operating mode”  
   * Complete when `orderNexus.modeInitialized === true`.

5. “Review your first profit & leakage insights”  
   * Optional marker once merchant has visited the profitability dashboard at least once.

---

# 🔵 OrderNexus — CNS Module Blueprint (LOCKED v2.0)

## 15. Job To Be Done (JBTD)

OrderNexus replaces “Revenue Vanity” with “Profit Reality” by revealing the precise unit economics of every single transaction.

**Typical merchant mindset:**
> “Revenue was up 20%, we’re doing great.”

**Reality:** shipping, fees, ads, and returns quietly erased the margin.

OrderNexus behaves like a forensic profit engine:

* **Per order,** it computes what actually hit the bank.
* **Per cohort,** it reveals why certain slices of the business bleed while others print money.

## 16. Phase Model

OrderNexus evolves in three phases, which map to feature + pricing maturity, not code branches.

### Phase 1 — “The Accountant” (FT0–FT1 Core)

**Goal:** Accurate historical reporting.  
**Question answered:** *“What did I really make yesterday / last week / last month?”*

**Capabilities:**

* Ingest orders into canonical form.
* Apply static COGS per SKU (from SKU-OS or manual).
* Deduct known:
* payment fees (Stripe/Shopify)
* shipping label costs
* platform fees where possible.
* Compute stable, auditable per-order profitability.

**Merchant actions:**

* Fill missing COGS.
* Confirm shipping & fee assumptions.
* Review per-order Profit Autopsy.

### Phase 2 — “The Analyst” (Growth)

**Goal:** Explain drivers of profitability.  
**Question answered:** *“Why is margin low in this country/channel/segment?”*

**Capabilities:**

* Overhead allocation rules (marketing, tools, ops) into per-order economics.
* Basic return impact from ReturnNexus (actual vs expected profit).
* Profitability slicing:
* by channel / traffic source
* by geography
* by SKU class / bundle group.
* Profit tiers / personas (Winners, Drifters, Bleeders).

**Merchant actions:**

* Define overhead distribution rules.
* Investigate profit drivers by channel / region / SKU cohort.
* Tune tolerance thresholds for alerts (e.g. “flag <15% margin in EU”).

### Phase 3 — “The CFO” (Architect)

**Goal:** Actively shape future profitability.  
**Question answered:** *“How do I increase net margin by 2–3 points without reckless guessing?”*

**Capabilities:**

* **Simulation Sandbox (what-if scenarios):**
* price change
* shipping cost rise
* fee changes
* CAC / paid traffic shocks.
* Prescriptive suggestions (long term, not FT0):
* recommended price adjustments per SKU or range
* suggested shipping rule adjustments
* warnings on structurally unprofitable bundles.
* Integration with InsightCore and Specter for demand + elasticity-aware decisions.

**Merchant actions:**

* Run “what if” scenarios before changing price / shipping.
* Accept or reject suggested changes.
* Configure automated guardrails (e.g. “block new campaigns on SKUs under 10% margin”).

## 17. Analytics Primitives — The Profit Ledger

OrderNexus owns the canonical per-order **Profit Ledger**.

Per `canonical_order_id`, we persist a **Profit Ledger row** with at least:

* `gross_revenue`
* `landed_cost_total`  
  * COGS + inbound freight / duties where available.
* `fulfillment_cost_actual`  
  * Pick/pack + label, or best estimate.
* `transaction_fees_total`  
  * Payment gateway + platform fees.
* `acquisition_cost_attributed`  
  * Per-order CAC; can be 0 or estimated.
* `overhead_allocated`  
  * Allocated fixed/variable overhead from MarginCore/Config.
* `net_profit_absolute`
* `net_margin_percent`
* `profit_tier`  
  * `'winner' | 'drifter' | 'bleeder' | 'loss_leader'`

**Leakage + diagnostics**

* `leakage_amount`  
  * Difference vs the expected standard model; anomaly budget.
* `leakage_severity_index` (0–1)  
  * Normalized indicator of how abnormal this order is from a cost/profit perspective.
* `profitability_dna`  
  * `'cac-heavy' | 'shipping-heavy' | 'sku-heavy' | 'discount-heavy' | 'refund-prone' | 'cross-sell-seeder' | 'high-margin-hero' | 'low-margin-filler'`.

* `profit_causation`:
  * `primary`: `'shipping' | 'fees' | 'cogs' | 'discounts' | 'returns' | 'cac' | 'overhead'`
  * `secondary`: `string[]`

**Confidence & overrides**

* `cost_confidence_score` (0–1)  
  * Quality of cost inputs (COGS completeness, override frequency, stability).
* `attribution_confidence_score` (0–1)  
  * Reliability of acquisition cost attribution.
* `overrides`:
  * `user_marked_loss_leader?: boolean`
  * `user_adjusted_cost?: boolean`
  * `user_adjusted_attribution?: boolean`
  * `user_annotated_reason?: string`

**Versioning (for auditability)**

* `profit_version_id`
* `previous_profit_version_id?`
* `delta_reason?`  
  * `'cogs_update' | 'fee_change' | 'shipping_update' | 'return_event' | 'manual_override' | 'config_change'`

This schema is the **conceptual contract**; the SQL table in §10 must remain compatible with these fields, even if some are stored in JSONB in v1 and later split out into columns.

This allows:

* time-travel profit history,
* batch recomputation,
* transparent corrections.

## 18. Core Widgets & Surfaces

### 18.1 Free Tier / Always-On Surfaces (FT0, within FTEP limits)

These are the minimum experiences OrderNexus must always offer while within free-tier usage.

* **Profit Autopsy Card (Hero)**
    For an individual order: visual breakdown of revenue vs cost components (bar or waterfall). Clear *“You actually made X”* statement. This is the primary FT0 “Aha!” moment.

* **Bleed Feed (Recent Loss-Making Orders)**
    List of top N most recent orders with negative net profit. Shows: order id, revenue, net profit, primary cause (from `profit_causation.primary`).

* **Missing Costs Counter**
    “X orders missing COGS” + CTA to “Fix missing costs.” Drives data integrity and keeps merchants engaged.

* **Basic Profit Trendline**
    Net margin % over time (daily/weekly). FT0 variant is read-only, no deep segmentation, no simulation.

* **Simple “Profit by Channel” Snapshot (Lite)**
    Very shallow breakdown: e.g. top 3 channels with revenue and net margin %. No deep drilldowns in FT0.

*These surfaces remain accessible while `order-nexus.freeTierState === 'free_tier_active'` (see FTEP contract).*

### 18.2 Growth / Paid Surfaces (Beyond Free Tier)

These become progressively paywalled beyond basic free tier limits and/or plan:

* **Full Profitability Explorer**
    Pivotable view: by channel, region, SKU class, bundle group, new vs returning, etc. Heatmaps, treemaps, sortable tables.

* **Fee Structure Analysis**
    “Where does your margin go?” Treemap: COGS vs shipping vs CAC vs fees vs overhead.

* **Profitability Personas / Cohort Cards**
    “Bleeder SKUs”, “Sleeper Winners”, “High Volume / Low Margin”, “Return-Prone”.

* **Simulation Sandbox (Architect tier hero)**
    Ask *“What if…”* about: prices, shipping costs, fee changes, CAC shifts. Output: how many orders / cohorts flip from Winner → Drifter → Bleeder.

* **Automated Profit Rules & Alerts**
    e.g. “Flag orders under 10% margin,” “alert when shipping exceeds X% of revenue.” Integration with Problem Center for persistent “profit problems”.

* **Prescriptive Pricing & Rule Suggestions (Long term)**
    Powered by OrderNexus + InsightCore + Specter. Example recommendations:
* “Increase price of SKU X by 7% to maintain target margin given rising CAC.”
* “Raise shipping fee in Region B to cover structural cost increases.”
* “Stop offering free shipping on this bundle; it creates Bleeders.”

## 19. Actions & Clear Paths

Every insight must resolve into a next step. OrderNexus must support at least:

* **Retrofit COGS**
    Bulk apply COGS to historical orders (via SKU-OS / cost settings).
* **Stop the Bleeding**
    Jump from a loss-making order / cohort directly to: SKU config in SKU-OS, shipping / fulfillment rules in WMS Lite (future).
* **Mark as Loss Leader**
    Explicit merchant override: “This was intentionally unprofitable.” Adjusts thresholds and prevents false alarms.
* **Dispute Label / Cost Spike (Phase 2)**
    Flag abnormal shipping / fee charges for manual review.

All of these feed into a **Closed Loop** where: `user fixes data → OrderNexus recomputes → Problem Center reflects reduced issues`.

## 20. Closed Loop & Learning

OrderNexus must support learning from corrections:

* **Cost Confidence Score per SKU/vendor:** repeated manual corrections → lowered confidence → prompts deeper integration (CSV import, ERP sync).
* **Leakage Tolerance:** dismissed alerts adjust local thresholds (per SKU category / region).
* **Attribution Tuning:** manual changes to acquisition source inform future attribution weights for that cohort.

*These are Phase 2+ behaviors, but the data fields for them must exist from v1 in the Profit Ledger.*

## 21. Free Tier Exposure & Gating (FTEP Alignment)

OrderNexus uses the global Free Tier policy:

* **Metric:** `orders`
* **Max Free Tier Units:** 50 orders per month

Signals produced by readiness providers:

* `order-nexus.freeTierState`: `ModuleAccessState`
* `order-nexus.freeTierRemaining`: `number | null`

**States:**

1. `visible` - Tab visible, module not yet initialized (no usage).
2. `free_tier_active` - Full free surfaces enabled (Profit Autopsy, Bleed Feed, basic trendline, simple profit-by-channel) up to 50 orders/month.
3. `free_tier_exhausted` - Free Tier limit reached. Read-only experience; CTAs focus on Upgrade and high-level summaries.
4. `locked` - No access (plan restriction). OrderNexus tab shows a `LockedFeaturePage` with value-driven pitch.

**Advanced intelligence surfaces are strictly paid:**

* Full Profitability Explorer (deep pivoting by cohort / DNA)
* Fee Structure Analysis / Profit Treemaps
* Simulation Sandbox (“what if cost / price / CAC changes?”)
* Automated profit rules & alerts
* Prescriptive pricing / shipping / promo suggestions

These **must never** be fully available on the free tier, even within the first 50 processed orders.  
Free-tier merchants only see **teaser variants** or upsell stubs, not the complete interactive experience.

## 22. Contract Stability

The following are considered locked for v1 unless explicitly versioned:

* **Readiness signal names:**
* `orderNexus.ordersIngested`
* `orderNexus.profitabilityActive`
* `order-nexus.freeTierState`
* `order-nexus.freeTierRemaining`
* **FTEP configuration for OrderNexus:**
* `metric`: `orders`
* `maxUnits`: `50`
* `resetPeriod`: `monthly`
* The existence of the **Profit Autopsy Card** as the hero FT0 experience.
* The general structure of the **Profit Ledger** fields (names may be refined, but semantics stay).

**This is the v2.0 blueprint you freeze into your docs and your repo.**

If anyone deviates from these contracts without first versioning them (e.g. `OrderNexus_v3`), they’re not building *OrderNexus* – they’re building something else.

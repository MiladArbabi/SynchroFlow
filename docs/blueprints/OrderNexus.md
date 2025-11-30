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
* Mode-aware profit policies & thresholds (Survival / Growth / Architect)
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

---

## 1. Core Types – The Canonical Model

### 1.1 Profit & Cost Types

```ts
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

```ts
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

```ts
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

```ts
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

```ts
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

```ts
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

```ts
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

```ts
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

```ts
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

```ts
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

OrderNexus consumes **order-level return impact** from ReturnNexus and persists it
separately from the original profitability snapshot.

```ts
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

Rules:

Exactly one ReturnOutcomeEvent per returnId value at a time.

If a return is adjusted or re-opened, ReturnNexus MUST emit a new
ReturnOutcomeEvent with the same returnId and updated totals.

OrderNexus MUST treat these as append-only events and MUST NOT mutate
the canonical order_profitability row.

---

## 3. PCD Hashing – Platform Contract

```ts
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

## 4. Mode Policies – Survival, Growth, Architect

```ts
// packages/order-nexus/src/policies/mode-policy-manager.ts

export type Mode = 'survival' | 'growth' | 'architect';

export const ORDER_NEXUS_MODE_POLICIES: Record<Mode, ModePolicies> = {
  survival: {
    minMarginPercent: 5,
    allowUnprofitableOrders: true,
    requireApprovalBelowMargin: false,
    leakageAlertThreshold: 50.0,
    automatedInterventions: ['SHIPPING_OPTIMIZATION'],
    maxCustomerAcquisitionCost: 25.0
  },
  growth: {
    minMarginPercent: 10,
    allowUnprofitableOrders: true,
    requireApprovalBelowMargin: true,
    leakageAlertThreshold: 25.0,
    automatedInterventions: ['SHIPPING_OPTIMIZATION', 'SERVICE_LEVEL_ADJUSTMENT'],
    maxCustomerAcquisitionCost: 35.0
  },
  architect: {
    minMarginPercent: 15,
    allowUnprofitableOrders: false,
    requireApprovalBelowMargin: true,
    leakageAlertThreshold: 10.0,
    automatedInterventions: [
      'SHIPPING_OPTIMIZATION',
      'SERVICE_LEVEL_ADJUSTMENT',
      'CUSTOMER_TERMS_ADJUSTMENT'
    ],
    maxCustomerAcquisitionCost: 50.0
  }
};

export class ModePolicyManager {
  constructor(
    private readonly shopConfigRepo: ShopConfigRepository,
    private readonly orderAnalytics: OrderAnalyticsService
  ) {}

  async getPoliciesForShop(shopId: number): Promise<ModePolicies> {
    const config = await this.shopConfigRepo.getShopMode(shopId);
    return ORDER_NEXUS_MODE_POLICIES[config.mode];
  }

  async getModeForShop(shopId: number): Promise<Mode> {
    const config = await this.shopConfigRepo.getShopMode(shopId);
    return config.mode;
  }

  async determineInitialMode(shopId: number): Promise<Mode> {
    const ordersLast30d = await this.orderAnalytics.getOrderCount(shopId, 30);
    if (ordersLast30d < 100) return 'survival';
    if (ordersLast30d < 1000) return 'growth';
    return 'architect';
  }
}
```

---

## 5. Normalization Boundary – No Raw Shopify Beyond This

```ts
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

```ts
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

```ts
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

## 8. CoreProfitEngine – Mathematically Correct, Mode-Aware

```ts
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

```ts
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

```ts
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

```ts
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

```ts
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

```ts
// packages/order-nexus/src/metrics/metrics-client.ts

export interface MetricsClient {
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void;
  incrementCounter(name: string, tags?: Record<string, string>): void;
}
```

```ts
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

```ts
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
> * **Mode-aware thresholds** and policies for Survival, Growth, and Architect modes.
> * **Customer profitability tiers** derived from realized order history (whale curve) when Specter is available.
> * **Graceful degradation**:
>
>   * If Financial Intelligence is unavailable → falls back to local cost models (`costModelSource = 'local'`, `computationSource = 'basic_fallback'`).
>   * If Specter is unavailable → uses inferred/default customer signals with explicit confidence.
> * **Operational SLA**:
>
>   * Target processing time: **5 seconds** per order under normal load.
>   * 99% of orders have profit data within **60 seconds** of webhook receipt.
>   * Queue delay warnings emitted after **25 seconds**.
> * **Auditability**:
>
>   * All recomputations tracked with:
>
>     * previous net profit
>     * previous cost model version
>     * history entries in `order_profitability_history`.
>   * Cost model sources (`finance` vs `local`) and computation reasons (`initial`, `recomputation`, `basic_fallback`) are explicitly stored and queryable.
>   * Post-return economic impact is stored separately in `order_return_impact`,
>     sourced exclusively from `ReturnOutcomeEvent` emitted by ReturnNexus.
> * **Contract Stability**:
>
>   * `NormalizedOrder`, `OrderProfitability`, `LandedCost`, `SpecterCustomerSignal`, `CostModelSnapshot`, `ProfitIntervention`, `LeakageDetection`, `ReturnOutcomeEvent`, and DB schemas in this blueprint are **locked** for Phase 1 / early Phase 2.
>   * Any changes require a versioned contract (`v2`) and migration plan, not ad-hoc modifications.

This is the blueprint you freeze into your docs and your repo.

If anyone deviates from these contracts, they’re not building *OrderNexus* – they’re building something else.

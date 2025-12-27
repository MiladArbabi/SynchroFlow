# **Document 3: OrderNexus - Engine Implementation**
**Version:** 2.0 (Locked Blueprint)
**Last Updated:** 2025-01-15
**Related Documents:**
- OrderNexus - Core Architecture & Boundaries
- OrderNexus - External Contracts & Integration
- OrderNexus - Operational Pipeline

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

**End of Document 3: Engine Implementation**

*Next document will cover: Operational Pipeline*
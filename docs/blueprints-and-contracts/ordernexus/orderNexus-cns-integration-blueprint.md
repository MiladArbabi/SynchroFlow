# **Document 6: OrderNexus - CNS Integration Blueprint**
**Version:** 2.0 (Locked Blueprint)
**Last Updated:** 2025-01-15
**Related Documents:**
- OrderNexus - Core Architecture & Boundaries
- OrderNexus - External Contracts & Integration
- OrderNexus - Product Vision & Evolution

---

## 4.3 CNS-Driven Interpretation Contract (LOCKED)

Profitability computation inside OrderNexus is PURE and CANNOT depend on merchant mode. However, **INSIGHT INTERPRETATION** depends on CNS context via InsightCore.

### OrderNexus → CNS (signals)

OrderNexus MUST emit:

```typescript
interface OrderNexusSignal {
  profitStabilityScore: number;     // 0–1
  leakageSeverityScore: number;     // 0–1
  fulfillmentCostVolatility: number; // 0–1
  revenueTrendScore: number;        // 0–1
}
```

### CNS → InsightCore → Widgets (interpretation)

**Survival Mode:**
- `leakageSeverityScore` drives **CRITICAL urgency**
- Framing: "You're bleeding money here" with red alerts
- Priority: Immediate cash preservation
- Action emphasis: "Stop the bleeding now"

**Growth Mode:**
- `leakageSeverityScore` drives **OPPORTUNITY framing**
- Framing: "Here's where you could optimize for scale"
- Priority: Efficient scaling
- Action emphasis: "Optimize for better unit economics"

**Architect Mode:**
- `leakageSeverityScore` drives **SYSTEM OPTIMIZATION insights**
- Framing: "Systemic inefficiency detected"
- Priority: Systematic improvement
- Action emphasis: "Build automated rules to prevent this"

OrderNexus MUST NOT implement these differences internally. Only InsightCore may render mode-aware interpretations.

---

## 14.3 Merchant-Facing Onboarding Tasks (What the FT0 UX Should Drive)

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

---

## 14.6 Suggested "OrderNexus Onboarding Checklist" (for the TaskList Tracker)

These are the tasks surfaced under an **"Orders & Profitability (OrderNexus)"** section.  
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
   * CTA: Navigate to a "Missing COGS" / SKU cost configuration view (owned by SKU-OS / cost settings).

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

---

## 14.7 Signals exposed to the Onboarding Engine (OrderNexus)

For the global `ModuleOnboardingReadiness` engine, OrderNexus exposes the following **locked signal set**:

* `orderNexus.profitabilityActive: boolean`  
  * `true` if `order_profitability` has ≥ 1 row for this shop.

* `orderNexus.ordersIngested: number`  
  * Backed by `COUNT(*) FROM order_profitability WHERE shop_id = :shopId`.
  * Used for:
    * `ordersIngested >= 1` → "Engine activated"
    * Higher thresholds (e.g. `>= 20`) can be used by analytics, but are not part of FT0 readiness.

* `orderNexus.costModelSource: 'finance' | 'local'`  
  * Derived from `CostModelService.getNormalizedCostModel(...)`.
  * Onboarding uses:
    * `costModelSource === 'finance'` → "Cost model calibrated (precise)"
    * `costModelSource === 'local'` → "Using fallback assumptions"

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

---

## 14.8 Mapping to OnboardingTaskListTracker

In the global OnboardingTaskListTracker, OrderNexus appears as:

**Group:** "Orders & Profitability"

**Tasks:**

1. "Connect your Shopify store"  
   * Driven by IntegrationContext (not owned by OrderNexus).

2. "Let us process your first orders"  
   * Complete when `orderNexus.profitabilityActive === true`.

3. "Calibrate your cost model" (recommended)  
   * Complete when `orderNexus.costModelSource === 'finance'`.

4. "Confirm your operating mode"  
   * Complete when `orderNexus.modeInitialized === true`.

5. "Review your first profit & leakage insights"  
   * Optional marker once merchant has visited the profitability dashboard at least once.

---

## 14.9 CNS Integration Patterns & Event Flow

```typescript
// packages/order-nexus/src/integration/cns-integration.ts

export interface OrderNexusCnsIntegration {
  // Emit signals to CNS
  emitProfitSignals(shopId: number): Promise<void>;
  
  // Consume CNS context for interpretation (not computation)
  applyCnsContext(
    shopId: number,
    context: CnsContextSnapshot
  ): Promise<InterpretationContext>;
  
  // Bridge to InsightCore for mode-aware rendering
  generateInsightFragments(
    profitability: OrderProfitability,
    context: InterpretationContext
  ): Promise<InsightFragment[]>;
}

export interface InterpretationContext {
  mode: 'survival' | 'growth' | 'architect';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  framing: 'risk' | 'opportunity' | 'optimization';
  suggestedActions: string[];
  displayPriorities: string[];
}

export class DefaultCnsIntegration implements OrderNexusCnsIntegration {
  constructor(
    private readonly cnsClient: CnsClient,
    private readonly insightCoreClient: InsightCoreClient,
    private readonly logger: Logger
  ) {}

  async emitProfitSignals(shopId: number): Promise<void> {
    const signals = await this.calculateProfitSignals(shopId);
    
    await this.cnsClient.emitOrderNexusSignals(shopId, {
      profitStabilityScore: signals.stability,
      leakageSeverityScore: signals.leakage,
      fulfillmentCostVolatility: signals.fulfillmentVolatility,
      revenueTrendScore: signals.revenueTrend
    });
  }

  async applyCnsContext(
    shopId: number,
    context: CnsContextSnapshot
  ): Promise<InterpretationContext> {
    // NEVER use mode for computation, only interpretation
    return {
      mode: context.merchantMaturityMode,
      urgency: this.determineUrgency(context),
      framing: this.determineFraming(context),
      suggestedActions: this.generateSuggestedActions(context),
      displayPriorities: this.determineDisplayPriorities(context)
    };
  }

  private determineUrgency(context: CnsContextSnapshot): InterpretationContext['urgency'] {
    switch (context.merchantMaturityMode) {
      case 'survival':
        return context.burningPriority === 'high' ? 'critical' : 'high';
      case 'growth':
        return 'medium';
      case 'architect':
        return 'low';
      default:
        return 'medium';
    }
  }

  private determineFraming(context: CnsContextSnapshot): InterpretationContext['framing'] {
    switch (context.merchantMaturityMode) {
      case 'survival':
        return 'risk';
      case 'growth':
        return 'opportunity';
      case 'architect':
        return 'optimization';
      default:
        return 'opportunity';
    }
  }

  private generateSuggestedActions(context: CnsContextSnapshot): string[] {
    const actions: string[] = [];
    
    if (context.merchantMaturityMode === 'survival') {
      actions.push('Prioritize cash-positive orders immediately');
      actions.push('Identify and eliminate top 3 profit leaks');
      actions.push('Review unprofitable customer segments');
    } else if (context.merchantMaturityMode === 'growth') {
      actions.push('Optimize unit economics for scaling');
      actions.push('Balance growth spend with profitability');
      actions.push('Identify high-margin expansion opportunities');
    } else if (context.merchantMaturityMode === 'architect') {
      actions.push('Build automated profit protection rules');
      actions.push('Systematize cost structure analysis');
      actions.push('Implement predictive margin modeling');
    }
    
    return actions;
  }

  private determineDisplayPriorities(context: CnsContextSnapshot): string[] {
    switch (context.merchantMaturityMode) {
      case 'survival':
        return ['cash_risk', 'urgent_leaks', 'negative_margin_orders'];
      case 'growth':
        return ['scaling_efficiency', 'unit_economics', 'channel_profitability'];
      case 'architect':
        return ['system_optimization', 'predictive_insights', 'automation_rules'];
      default:
        return ['unit_economics', 'profit_leaks', 'customer_profitability'];
    }
  }

  private async calculateProfitSignals(shopId: number): Promise<{
    stability: number;
    leakage: number;
    fulfillmentVolatility: number;
    revenueTrend: number;
  }> {
    // Implementation would calculate actual signals
    // This is pure computation, independent of mode
    return {
      stability: 0.8,
      leakage: 0.3,
      fulfillmentVolatility: 0.2,
      revenueTrend: 0.7
    };
  }
}
```

---

## 14.10 Mode-Agnostic Computation Enforcement

```typescript
// packages/order-nexus/src/validation/mode-agnostic-validator.ts

/**
 * Validator that ensures OrderNexus remains mode-agnostic in computation.
 * This is a runtime guard against accidental mode-dependent logic.
 */
export class ModeAgnosticValidator {
  private readonly FORBIDDEN_MODE_CHECKS = [
    'survival',
    'growth', 
    'architect',
    'merchantMaturityMode',
    'mode',
    'revenueBand',
    'burningPriority'
  ];

  constructor(private readonly logger: Logger) {}

  /**
   * Validates that a function doesn't contain mode-dependent logic.
   * Should be used in critical computation paths.
   */
  validateComputationFunction(
    fn: Function,
    context: string
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const fnString = fn.toString().toLowerCase();

    // Check for forbidden mode references
    for (const check of this.FORBIDDEN_MODE_CHECKS) {
      if (fnString.includes(check.toLowerCase())) {
        issues.push(`Function ${context} contains mode-dependent reference: ${check}`);
      }
    }

    // Check for conditional branching that might be mode-related
    const conditionPatterns = [
      /if.*mode/i,
      /switch.*mode/i,
      /case.*survival/i,
      /case.*growth/i,
      /case.*architect/i
    ];

    for (const pattern of conditionPatterns) {
      if (pattern.test(fnString)) {
        issues.push(`Function ${context} contains potential mode-dependent branching`);
        break;
      }
    }

    if (issues.length > 0) {
      this.logger.error('Mode-dependent computation detected', {
        context,
        issues,
        function: fn.name || 'anonymous'
      });
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Runtime guard for mode-agnostic computation.
   * Throws in development/staging if mode-dependent logic is detected.
   */
  guardModeAgnostic<T extends any[], R>(
    fn: (...args: T) => R,
    context: string
  ): (...args: T) => R {
    return (...args: T): R => {
      if (process.env.NODE_ENV !== 'production') {
        const validation = this.validateComputationFunction(fn, context);
        if (!validation.valid) {
          throw new Error(
            `Mode-dependent computation detected in ${context}: ${validation.issues.join(', ')}`
          );
        }
      }
      return fn(...args);
    };
  }
}
```

---

**End of Document 6: CNS Integration Blueprint**
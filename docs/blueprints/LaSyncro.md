**LaSyncro** – Locked Technical Blueprint & Contracts (v1)

0. Scope & Non-Negotiables

This document locks:

 1. Platform architecture & module boundaries
 2. Core inter-module contracts (Specter, OrderNexus, SKU OS, Finance, Analytics Core, WMS Lite, Echo Hub)
 3. Critical Phase 1 backbone:
 • Cost Model Versioning & Recompute Scope
 • PCD Compliance (Specter)
 • Circuit Breakers for cross-module RPC

Any change to types or contracts marked LOCKED requires a versioned contract (v2) and migration plan. No ad-hoc modifications.

⸻

1. Platform Architecture – Modules & Layers

1.1 Layers
 • Layer 1 – Intelligence (Brain)
 • Analytics Core
 • OrderNexus (Order Profit Intelligence)
 • SKU OS (Product & Inventory Intelligence)
 • Specter (Customer & Conversion Intelligence)
 • Financial Intelligence
 • Layer 2 – Operations (Muscle)
 • WMS Lite (Inventory & Fulfillment Execution)
 • Echo Hub (Workflow & Tasks)
 • Integration Gateway (Shopify, other platforms)
 • Layer 3 – Learning (Cerebellum)
 • Feedback Processor
 • Reinforcement / adaptive engines (future)
 • Layer 4 – Governance (Prefrontal Cortex)
 • Confidence scoring
 • Approvals
 • Audit & Risk models

1.2 Module Responsibility Contracts

Analytics Core (READ-ONLY)
OWNS:
 • Reporting datasets (orders, products, customers, profit, inventory health, conversion metrics)
 • Widget API + 4C metadata (Context, Causation, Clear Path, Closed Loop)
 • Free-tier dashboard semantics and TeaserTriggers

DOES NOT OWN:
 • Business rules for pricing, profitability, replenishment, conversion, or workflows.

⸻

OrderNexus – Profit-First Order Intelligence
OWNS:
 • True order-level profitability:
 • Landed cost (COGS, shipping, handling, packaging, payment fees, overhead)
 • Net profit & margin %
 • Profit status: 'HEALTHY' | 'AT_RISK' | 'UNPROFITABLE'
 • Profit leakage detection
 • Mode-aware thresholds (Survival / Growth / Architect)
 • Profit interventions (suggestions only, not execution)
 • Order profitability persistence & recomputation history

DOES NOT OWN:
 • SKU-level stock or replenishment (SKU OS)
 • Customer behavior & LTV models (Specter)
 • Cash flow, P&L, forecasting (Financial Intelligence)
 • Fulfillment & tasks (WMS Lite / Echo Hub)

LOCKED TYPES (excerpt):

export type ProfitStatus = 'HEALTHY' | 'AT_RISK' | 'UNPROFITABLE';

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

  costModelVersion: string;      // LOCKED: filled from CostModelVersioning.versionId
  costModelSource: 'finance' | 'local';
  computationSource: 'initial' | 'recomputation' | 'basic_fallback';

  previousNetProfit?: number;
  previousCostModelVersion?: string;
}

⸻

SKU OS – Product & Inventory Intelligence
OWNS:
 • Product health scoring (stockout risk, overstock, margin health)
 • Inventory health dashboard
 • Playbooks:
 • REORDER_PROTECT
 • LIQUIDATE_OVERSTOCK
 • MARGIN_GUARD
 • Demand signals & co-purchase graph from orders data

DOES NOT OWN:
 • Order-level profitability or cost (OrderNexus)
 • Execution of replenishment (WMS Lite)
 • Customer-centric behavior intelligence (Specter)

LOCKED DATA CONTRACTS:

CREATE TABLE product_demand_signals (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  order_count_7d INTEGER DEFAULT 0,
  order_count_30d INTEGER DEFAULT 0,
  unit_sales_7d INTEGER DEFAULT 0,
  unit_sales_30d INTEGER DEFAULT 0,
  returns_rate_30d DECIMAL(4,3),
  avg_selling_price DECIMAL(10,2),
  last_order_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE product_affinity_pairs (
  shop_id INTEGER REFERENCES shops(id),
  product_a_id INTEGER REFERENCES products(id),
  product_b_id INTEGER REFERENCES products(id),
  co_purchase_count INTEGER DEFAULT 0,
  co_purchase_rate DECIMAL(5,4),
  lift_score DECIMAL(6,3),
  first_co_purchase_at TIMESTAMPTZ,
  last_co_purchase_at TIMESTAMPTZ,
  PRIMARY KEY (shop_id, product_a_id, product_b_id)
);

export interface ProductHealthEvents {
  PRODUCT_HEALTH_UPDATED: {
    productId: number;
    healthScore: number;
    stockoutRisk: number;
    marginHealth: 'healthy' | 'at_risk' | 'critical';
    confidence: 'low' | 'medium' | 'high';
  };

  PLAYBOOK_CREATED: {
    productId: number;
    playbookType: 'REORDER_PROTECT' | 'LIQUIDATE_OVERSTOCK' | 'MARGIN_GUARD';
    urgency: 'critical' | 'high' | 'medium';
    expectedImpact: number;
  };
}

⸻

Specter – Customer & Conversion Intelligence
OWNS:
 • Anonymous session → intent pipeline (PCD-safe)
 • Customer signal service:

async getCustomerSignal(
  shopId: number,
  hashedCustomerId: string | null
): Promise<SpecterCustomerSignal>;

 • Nudge engine contracts:
 • NudgeRecommendation
 • NudgeExecutionRequest
 • Latency-bounded decision logic with safe fallback

DOES NOT OWN:
 • Order-level profitability (OrderNexus)
 • Execution of nudges (onsite, email, SMS)
 • Customer hashing secrets (shared PcdHasher)

LOCKED v1 HTTP ENTRYPOINT:

POST /api/specter/v1/nudge-recommendation
Content-Type: application/json

Body:
{
  "shopId": number,
  "session": RawSession
}

Response:

- 200 OK: NudgeExecutionRequest | null
- 400: PCD violation

LOCKED PCD TYPES:

export interface RawSession {
  shopId: number;
  customerId?: string;      // MUST NOT be persisted
  landingPage: string;
  pagesViewed: string[];
  exitIntent: boolean;
}

export interface AnonymousSession {
  shopId: number;
  sessionId: string;
  landingPage: string;
  pagesViewed: string[];
  exitIntent: boolean;
  createdAt: string;        // ISO
}

⸻

Financial Intelligence
OWNS:
 • CostModelSnapshot for each shop
 • Policy thresholds (min margin, max cost-to-serve)
 • Cost model evolution and versioning metadata

DOES NOT OWN:
 • Profit computation (OrderNexus)
 • Order / product datasets

LOCKED CONTRACT TO ORDERNEXUS:

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

⸻

WMS Lite & Echo Hub
WMS Lite (Ops Execution)
 • Executes product playbooks & replenishment decisions
 • Manages inventory locations, POs, fulfillment jobs
 • Consumes: ReorderRecommendation & FulfillmentProfitSignal

Echo Hub (Workflows)
 • Turns interventions into tasks & approvals
 • Consumes: ProfitTaskPayload, inventory/ops tasks

Both are consumers of intelligence, not sources of it.

⸻

2. Phase 1 Backbone – Locked Contracts

2.1 Cost Model Versioning & Profit Recompute

Problem: Cost model changes must not silently corrupt historical profitability.

Contract:

 1. Every OrderProfitability record MUST set:
 • costModelVersion: CostModelVersioning.versionId
 • costModelSource: CostModelVersioning.source
 2. Financial Intelligence MUST provide:

async getCostModel(shopId: number): Promise<CostModelSnapshot | null>;

and on update, a CostModelVersioning with explicit recomputationScope.

 3. OrderNexus MUST NOT recompute historical orders in-line; it MUST queue recomputations via OrderRecomputeQueue.

Repositories (LOCKED extension):

export interface OrderProfitabilityRepository {
  getOrderProfitability(shopId: number, orderId: string): Promise<OrderProfitability | null>;
  saveOrderProfitability(profit: OrderProfitability): Promise<void>;

  // Range is interpreted over order_date in order_profitability
  getOrdersNeedingRecomputation(
    shopId: number,
    from: Date,
    to: Date
  ): Promise<Array<{ orderId: string }>>;
}

export interface OrderRecomputeQueueMessage {
  shopId: number;
  orderId: string;
  reason: 'cost_model_update' | string;
}

export interface OrderRecomputeQueue {
  enqueue(msg: OrderRecomputeQueueMessage): Promise<void>;
}

Recomputation Service (LOCKED behavior):

export class ProfitRecomputationService {
  constructor(
    private readonly profitRepo: OrderProfitabilityRepository,
    private readonly queue: OrderRecomputeQueue,
    private readonly logger: Logger
  ) {}

  async onCostModelUpdated(
    shopId: number,
    costModelVersion: CostModelVersioning
  ): Promise<void> {
    const { recomputationScope, recomputationSince, updatedAt } = costModelVersion;

    if (recomputationScope === 'none' || recomputationScope === 'new_orders_only') {
      return; // future orders only
    }

    if (recomputationScope === 'all_orders_since') {
      if (!recomputationSince) {
        throw new Error('InvalidCostModelVersion: recomputationSince required for all_orders_since');
      }

      await this.queueRecomputationForRange(
        shopId,
        new Date(recomputationSince),
        new Date(updatedAt)
      );
    }
  }

  private async queueRecomputationForRange(
    shopId: number,
    from: Date,
    to: Date
  ): Promise<void> {
    try {
      const orders = await this.profitRepo.getOrdersNeedingRecomputation(shopId, from, to);

      for (const order of orders) {
        await this.queue.enqueue({
          shopId,
          orderId: order.orderId,
          reason: 'cost_model_update'
        });
      }
    } catch (error: any) {
      this.logger.error('Failed to queue profit recomputation', {
        shopId,
        from,
        to,
        error: error.message
      });
      // Metrics: cost_model_recomputation_failed++
    }
  }
}

OrderRecompute Worker:
 • MUST call existing OrderProfitService.recomputeOrderProfitability(shopId, orderId, reason).

⸻

2.2 PCD Compliance – Specter URL & Session Guards

Problem: Specter must never process or persist raw PCD (customerId, email, etc.).

Contract:

 1. RawSession.customerId is forbidden; presence MUST trigger a PCD_VIOLATION and a 400 response.
 2. URL query params with keys in ['email','e','phone','tel','name','address'] MUST be stripped before persistence / analytics.
 3. Specter’s normalization MUST be pure, synchronous, and deterministic.

LOCKED Implementation:

export class PrivacyGuards {
  private static readonly DEFAULT_PII_KEYS = ['email', 'e', 'phone', 'tel', 'name', 'address'];

  static stripPIIFromUrl(url: string): string {
    let u: URL;
    try {
      u = new URL(url, '<https://dummy.host>');
    } catch {
      return '/invalid-url';
    }

    for (const key of Array.from(u.searchParams.keys())) {
      if (this.DEFAULT_PII_KEYS.includes(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }

    const search = u.searchParams.toString();
    return search ? `${u.pathname}?${search}` : u.pathname;
  }

  static assertNoRawCustomerId(raw: RawSession) {
    if (raw.customerId) {
      throw new Error('PCD_VIOLATION: Raw customerId found in Specter payload');
    }
  }

  static normalizeSession(raw: RawSession): AnonymousSession {
    this.assertNoRawCustomerId(raw);

    return {
      shopId: raw.shopId,
      sessionId: sessionIdService.generate(),
      landingPage: this.stripPIIFromUrl(raw.landingPage),
      pagesViewed: raw.pagesViewed.map((p) => this.stripPIIFromUrl(p)),
      exitIntent: raw.exitIntent,
      createdAt: new Date().toISOString()
    };
  }
}

API Handler Obligations:

async function handler(req, res) {
  const { shopId, session: rawSession } = req.body as NudgeRequestBody;

  let normalized: AnonymousSession;
  try {
    normalized = PrivacyGuards.normalizeSession(rawSession);
  } catch (e: any) {
    if (e.message.startsWith('PCD_VIOLATION')) {
      logger.warn('PCD_VIOLATION_RAW_CUSTOMER_ID', { shopId });
      return res.status(400).json({ error: 'Invalid session payload (PCD violation)' });
    }
    throw e;
  }

  if (rawSession.landingPage !== normalized.landingPage) {
    logger.info('PCD_URL_PARAMS_REMOVED', { shopId, removed: true });
  }

  // proceed with customerSignal + nudge engine...
}

PCD Test Suite (MUST exist in CI):
 • PII params removed.
 • Non-PII preserved.
 • Raw customerId throws PCD_VIOLATION.

⸻

2.3 Circuit Breakers – Cross-Module RPC

Problem: Finance / Specter downtime must not cascade into core failures.

Contract:

 1. Cross-module RPC from OrderNexus to:
 • FinanceClient.getCostModel
 • SpecterClient.getCustomerSignal
MUST go through ModuleCircuitBreaker.
 2. When the circuit is open:
 • Finance → fallback to local cost model
 • Specter → fallback to inferred/default customer signal
 • Metrics MUST be incremented.

LOCKED Implementation:

type ModuleName = 'finance' | 'specter';

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

interface CircuitState {
  failures: number;
  lastFailureAt?: number;
  open: boolean;
}

export class ModuleCircuitBreaker {
  private state = new Map<ModuleName, CircuitState>();

  constructor(
    private readonly config: Record<ModuleName, CircuitBreakerConfig>,
    private readonly metrics: MetricsClient
  ) {}

  async callWithCircuitBreaker<T>(
    module: ModuleName,
    operation: () => Promise<T>,
    fallback: () => T
  ): Promise<T> {
    if (this.isOpen(module)) {
      this.metrics.incrementCounter('module_circuit_open', { module });
      return fallback();
    }

    try {
      const result = await operation();
      this.recordSuccess(module);
      return result;
    } catch (error: any) {
      this.recordFailure(module, error);
      return fallback();
    }
  }

  private isOpen(module: ModuleName): boolean {
    const s = this.state.get(module);
    if (!s?.open) return false;

    const cfg = this.config[module];
    const now = Date.now();

    if (s.lastFailureAt && now - s.lastFailureAt > cfg.resetTimeoutMs) {
      return false; // half-open
    }

    return true;
  }

  private recordSuccess(module: ModuleName): void {
    this.state.set(module, { failures: 0, open: false });
  }

  private recordFailure(module: ModuleName, error: Error): void {
    const cfg = this.config[module];
    const current = this.state.get(module) || { failures: 0, open: false };
    const failures = current.failures + 1;
    const open = failures >= cfg.failureThreshold;

    this.state.set(module, {
      failures,
      open,
      lastFailureAt: Date.now()
    });

    this.metrics.incrementCounter('module_circuit_failure', {
      module,
      error: error.name || 'UnknownError'
    });
  }
}

Bootstrap (single instance per process):

const circuitBreaker = new ModuleCircuitBreaker(
  {
    finance: { failureThreshold: 5, resetTimeoutMs: 60000 },
    specter: { failureThreshold: 5, resetTimeoutMs: 60000 }
  },
  metricsClient
);

// Inject into CostModelService, FallbackManager, etc.

Use in CostModelService (LOCKED behavior):

async getNormalizedCostModel(
  shopId: number
): Promise<{ model: NormalizedCostModel; version: CostModelVersioning }> {
  return this.circuitBreaker.callWithCircuitBreaker(
    'finance',
    async () => {
      const externalModel = await this.financeClient.getCostModel(shopId);
      if (!externalModel) {
        throw new Error('NoExternalCostModel');
      }

      return {
        model: this.normalizer.normalize(shopId, externalModel),
        version: {
          versionId: `finance:${externalModel.updatedAt}`,
          source: 'finance',
          updatedAt: externalModel.updatedAt,
          recomputationScope: 'none'
        }
      };
    },
    () => this.getLocalFallbackModel(shopId)
  );
}

⸻

3. Phase 1 Metrics – Minimum Required

These metrics are required, not optional:

const ESSENTIAL_METRICS = {
  data_consistency: {
    orders_with_cost_model_version: 'Gauge – should be 100%',
    cost_model_recomputation_queued: 'Counter – when all_orders_since triggers',
    cost_model_recomputation_failed: 'Counter – failures in queueRecomputationForRange'
  },
  resilience: {
    module_circuit_open: 'Counter – per module (finance, specter)',
    module_circuit_failure: 'Counter – per module & error type'
  },
  pcd_compliance: {
    pcd_url_params_removed: 'Counter – per shop (from handler logs)',
    pcd_violation_attempts: 'Counter – raw customerId attempts'
  }
};

⸻

Whoever builds against this is either building LaSyncro — or something incompatible with it.

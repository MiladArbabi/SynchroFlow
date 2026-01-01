# MarginCore – External Contracts (v1 Locked)

These are **frozen** and already referenced inside LaSyncro. MarginCore must implement them exactly.

## Cost Model to OrderNexus

```typescript
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

## Finance Client Contract (Consumer-facing)

```typescript
// Public API used by OrderNexus CostModelService
export interface FinanceClient {
  getCostModel(shopId: number): Promise<CostModelSnapshot | null>;
}
```

### Contract Rules
* Returns **active cost model** for `shopId`, or `null` if none (OrderNexus falls back to `BASIC_COST_MODEL`)
* Must be **low-latency** and read-oriented (cache heavily)
* Must not throw for "no model"; return `null` instead
```
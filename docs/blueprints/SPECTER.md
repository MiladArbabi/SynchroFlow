# SPECTER – Locked Module Blueprint (v1 + Integration Contract)

## 0. Role, Mission & Boundaries

### 0.1 Role in LaSyncro

* **Module Name:** Specter – Customer Intelligence & Conversion Module
* **Role in CNS:** Customer-side “intent & value” node in the LaSyncro nervous system.

### 0.2 Mission

> **Specter Mission (v1–v3):**  
> Provide **privacy-preserving**, **low-latency**, and **margin-safe** customer signals and nudge recommendations that make conversion opportunities actionable — while **never** persisting raw PCD or executing channel actions.  
>
> In v1, Specter focuses on **exit-intent reminders only** (no discounts), under a strict 100 ms latency budget and PCD guards.  
> In v2+, Specter becomes CNS-aware (uses aggregated signals from other modules).  
> In v3, Specter supports privacy-preserving personalization and orchestrated experiments via channel modules — still without owning PCD or execution.

**Job-to-be-done (JTBD):**  
Make customer behavior **measurable and influenceable** without exposing PCD — by surfacing where a merchant can safely nudge (e.g., exit-intent sessions) and what uplift they can expect.

**FT0 Aha (free-tier moment):**

> “We can recover X% of exit-intent sessions with a safe reminder — here are the pages and the expected uplift.”

Specter does **not** own identity, execution, or pricing.  
It owns **signals** and **safe recommendations**.

### 0.3 Owns vs Does Not Own

**Specter OWNS:**

* Anonymous session tracking and intent signals (PCD-safe)
* PCD-compliant customer signals (`SpecterCustomerSignal`)
* Nudge **recommendations** (what to show, not how to send)
* Basic conversion-safe heuristics (exit-intent reminder, no discounts in v1)
* Latency-bounded decision logic (100 ms internal budget)

**Specter DOES NOT OWN:**

* Order-level profitability → **OrderNexus**
* SKU-level risk, replenishment, inventory → **SKU OS**
* True cost models, P&L, cash flow → **Financial Intelligence**
* Fulfillment execution, routing, warehouse ops → **WMS Lite**
* Workflow/task execution → **Echo Hub**
* Global dashboards & cross-module charts → **Analytics Core**
* Channel execution (email/SMS/push, etc.) → dedicated channel modules

Specter produces **intelligence** and **NudgeExecutionRequest** events. Execution belongs elsewhere.

### 0.4 CNS Value Blueprint (Summary)

This section ties Specter into the CNS-wide design (InsightCore, OrderNexus, SKU OS, etc.) and is additive to the concrete contracts defined below.

**1. Job To Be Done**

* Make customer behavior **measurable and influenceable** without exposing PCD.
* Surface **where** a nudge is safe and worthwhile (e.g., exit-intent sessions) and **what uplift** is realistic.

**2. Free-tier Aha (FT0)**

* Single insight:  
  > “Your top nudge opportunity is on pages X – exit-intent reminders could lift conversions by ~Y% with no discounts.”
* This leverages existing primitives (exitIntent, sessions) and the v1 REMINDER-only engine.

**3. Phase Plan**

* **Phase 1 (v1)** – what’s already here:
  * PCD guards, 100 ms latency budget, REMINDER-only, `NudgeExecutionRequest`.
  * Simple `SpecterCustomerSignal` default.
  * `specter.sdkInstalled` readiness signal.
* **Phase 2 (v2)** – extend via existing future contracts:
  * `CustomerSignalResult` with `source`, `confidence`, `dataSources`.
  * `SpecterFallbackManager` + OrderNexus / SKU OS enrichment (aggregated).
  * More nuanced opportunities surfaced (still margin-safe).
* **Phase 3 (v3)** – build on v2:
  * Privacy-preserving cohorts and experiments.
  * Orchestrated, policy-constrained nudges via channel modules.

**4. Analytics Primitives Specter Owns (CNS-level)**

These map onto, but are not limited to, the implementations later in this blueprint:

* `session_count`
* `exit_intent_count`
* `exit_intent_rate = exit_intent_count / session_count`
* `page_exit_intent_rate(page_key)`
* `nudge_opportunity { page_key, exit_intent_rate, expected_lift_estimate, confidence }`
* `signal_confidence: 'low' | 'medium' | 'high'`

Other modules may **read** these, but must not redefine them with different semantics.

**5. Core Widgets (for InsightCore dashboards / Specter UIs)**

* **Exit Intent Overview** – sessions, exit_intent_rate, top pages.
* **Top Nudge Opportunity** – the FT0 Aha widget (page, exit_intent_rate, expected_lift, confidence).
* **SDK Health** – `specter.sdkInstalled`, recent event timestamps.

**6. Clear Path Actions**

Specter never executes actions, but must feed Clear Path recommendations (via InsightCore or directly) such as:

* `enable_sdk` – “Install and enable Specter tracking.”
* `enable_page_reminder` – “Turn on exit-intent reminder on high-opportunity pages.”
* `create_onsite_experiment` – “Test reminder vs no reminder on top exit pages.”

Each action maps to the global `InsightActionRecommendation` contract (targetModule, actionId, rationale, urgency, expectedImpactEstimate, confidence, evidence, context).

**7. Closed Loop**

Specter learns from:

* Aggregated `NudgeOutcome` data (impressions, clicks, conversions) per page/time window.
* Optional aggregated profit deltas from OrderNexus (no customer-level join).
* It updates `expected_lift` and `signal_confidence` using simple moving averages in v1 and more robust attribution in v2+.

This CNS summary is **descriptive**, not a new code contract; the concrete types and functions for PCD, latency, fallback, and future integration remain as defined in the sections below.

---

## 1. Core v1 Contract Summary

**v1 must guarantee:**

1. **PCD Safety**

   * No raw `customerId` / email / phone is persisted.
   * URLs are normalized to strip obvious PII query parameters.
2. **Single Entry Point**

   * All external consumers use **one HTTP API** for session-based nudges.
3. **Latency**

   * Nudge decisions are bounded by an internal **100 ms** budget and fall back safely if exceeded.
4. **Safety of Offers**

   * v1: **no discounts** – only REMINDER nudges (no margin erosion).

Anything beyond this is future-phase.

---

## 2. Data & Identity – PCD Foundation

### 2.1 Session Types

```ts
// packages/specter/src/types/session-types.ts

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
```

### 2.2 Privacy Guards (Locked Behavior)

```ts
// packages/specter/src/compliance/privacy-guards.ts

export class PrivacyGuards {
  static assertNoRawCustomerId(raw: RawSession) {
    if (raw.customerId) {
      throw new Error('PCD_VIOLATION: Raw customerId found in Specter payload');
    }
  }

  static stripPIIFromUrl(url: string): string {
    let u: URL;
    try {
      u = new URL(url, 'https://dummy.host');
    } catch {
      return '/invalid-url';
    }

    ['email', 'e', 'phone', 'tel', 'name', 'address'].forEach((key) =>
      u.searchParams.delete(key)
    );

    const search = u.searchParams.toString();
    return search ? `${u.pathname}?${search}` : u.pathname;
  }

  static normalizeSession(raw: RawSession): AnonymousSession {
    this.assertNoRawCustomerId(raw);

    return {
      shopId: raw.shopId,
      sessionId: sessionIdService.generate(), // injected UUID-like service
      landingPage: this.stripPIIFromUrl(raw.landingPage),
      pagesViewed: raw.pagesViewed.map((p) => this.stripPIIFromUrl(p)),
      exitIntent: raw.exitIntent,
      createdAt: new Date().toISOString()
    };
  }
}
```

### 2.3 PCD Tests (Executable Contract)

```ts
// test/pcd-compliance.test.ts

describe('PCD Compliance', () => {
  it('throws when raw customerId is present', () => {
    const rawSession: RawSession = {
      shopId: 1,
      customerId: '123',
      landingPage: '/test',
      pagesViewed: [],
      exitIntent: false
    };

    expect(() => PrivacyGuards.normalizeSession(rawSession))
      .toThrow('PCD_VIOLATION');
  });

  it('strips PII from URLs', () => {
    const rawSession: RawSession = {
      shopId: 1,
      landingPage: '/test?email=user@example.com&phone=123',
      pagesViewed: ['/page?name=John&address=123MainSt'],
      exitIntent: false
    };

    const normalized = PrivacyGuards.normalizeSession(rawSession);

    expect(normalized.landingPage).toBe('/test');
    expect(normalized.pagesViewed[0]).toBe('/page');
  });
});
```

---

## 3. Public API – v1 HTTP Contract

### 3.1 Endpoint

```http
POST /api/specter/v1/nudge-recommendation
Content-Type: application/json
```

#### Request Body

```ts
type NudgeRequestBody = {
  shopId: number;
  session: RawSession;
};
```

#### Response

```ts
type NudgeResponseBody = NudgeExecutionRequest | null;
```

* `200 OK` – valid request, returns recommendation or `null`.
* `400 Bad Request` – PCD violation (raw customerId present).
* `5xx` – unexpected server error (non-PCD related).

### 3.2 Handler Flow (Locked Order of Operations)

```ts
// pseudocode – packages/specter/src/api/nudge-handler.ts

async function handler(req, res) {
  const { shopId, session: rawSession } = req.body as NudgeRequestBody;

  let normalized: AnonymousSession;
  try {
    normalized = PrivacyGuards.normalizeSession(rawSession);
  } catch (e: any) {
    if (e.message.startsWith('PCD_VIOLATION')) {
      return res.status(400).json({ error: 'Invalid session payload (PCD violation)' });
    }
    throw e;
  }

  const customerSignal = await customerIntelligenceService.getCustomerSignal(
    shopId,
    null // v1: no hashed customer
  );

  const executionRequest = await degradationManager.withLatencyBudget(
    shopId,
    () =>
      nudgeExecutionAdapter.buildExecutionRequest(
        shopId,
        normalized,
        customerSignal
      ),
    () => degradationManager.getSafeFallbackNudge(normalized)
  );

  return res.status(200).json(executionRequest);
}
```

---

## 4. Core Customer Intelligence Types

### 4.1 SpecterCustomerSignal (Shared Contract)

```ts
// packages/specter/src/types/customer-signal-types.ts

export interface SpecterCustomerSignal {
  shopId: number;
  hashedCustomerId: string;
  specterCustomerTier: 'VIP' | 'CORE' | 'PROMO_DEPENDENT' | 'RISKY' | 'UNKNOWN';
  predictedLTV: number;
  churnRisk: number;        // 0–1
  priceSensitivity: number; // 0–1
  returnsRisk: number;      // 0–1
  updatedAt: string;        // ISO
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
```

### 4.2 v1 Customer Intelligence Service

```ts
// packages/specter/src/public/specter-customer-intelligence-service.ts

export class SpecterCustomerIntelligenceService {
  async getCustomerSignal(
    shopId: number,
    hashedCustomerId: string | null
  ): Promise<SpecterCustomerSignal> {
    // v1: no per-customer intelligence, just default
    return createDefaultCustomerSignal(shopId, hashedCustomerId ?? 'anonymous');
  }
}
```

* This is the **only** way anything in LaSyncro should obtain Specter customer intelligence.
* In later phases, this service will add:

  * OrderNexus enrichment,
  * Freshness checks,
  * Fallback logic.

---

## 5. Nudge Intelligence & Execution Contract

### 5.1 Nudge Types

```ts
// packages/specter/src/types/nudge-types.ts

export interface NudgeOffer {
  type: 'NONE' | 'PERCENT_DISCOUNT' | 'FIXED_DISCOUNT'; // v1: ALWAYS 'NONE'
  value: number;        // 0.0–1.0 for percent, currency for fixed
  expiration: string | null; // ISO or null
  conditions: string[];      // e.g. ['MIN_CART_VALUE_50']
}

export interface NudgeRecommendation {
  shopId: number;
  sessionId: string;
  channel: 'onsite';         // v1: onsite only
  nudgeType: 'REMINDER';     // v1: only REMINDER
  offer: NudgeOffer;
  messageKey: string;
  reason: string;
  expectedLift: number;
  marginImpactEstimate: number;
  confidence: number;        // 0–1
}

export interface NudgeExecutionRequest {
  recommendation: NudgeRecommendation;
  sessionContext: AnonymousSession;
  customerContext?: SpecterCustomerSignal;
  executionDeadline: string; // ISO
}
```

### 5.2 Nudge Engine Contract

```ts
// packages/specter/src/engine/interfaces.ts

export interface ISpecterNudgeEngine {
  generateRecommendation(
    shopId: number,
    session: AnonymousSession,
    customerSignal?: SpecterCustomerSignal
  ): Promise<NudgeRecommendation | null>;
}
```

### 5.3 v1 Simple Nudge Engine (Locked Logic)

```ts
// packages/specter/src/engine/simple-nudge-engine.ts

export class SimpleNudgeEngine implements ISpecterNudgeEngine {
  async generateRecommendation(
    shopId: number,
    session: AnonymousSession,
    customerSignal?: SpecterCustomerSignal
  ): Promise<NudgeRecommendation | null> {
    if (!session.exitIntent) return null;

    return {
      shopId,
      sessionId: session.sessionId,
      channel: 'onsite',
      nudgeType: 'REMINDER',
      offer: {
        type: 'NONE',
        value: 0,
        expiration: null,
        conditions: []
      },
      messageKey: 'specter.exit_intent.reminder',
      reason: 'Exit intent detected; safe reminder',
      expectedLift: 0.05,
      marginImpactEstimate: 0,
      confidence: 0.2
    };
  }
}
```

### 5.4 Execution Adapter (Intelligence → Event)

```ts
// packages/specter/src/engine/nudge-execution-adapter.ts

export class NudgeExecutionAdapter {
  constructor(private readonly engine: ISpecterNudgeEngine) {}

  async buildExecutionRequest(
    shopId: number,
    session: AnonymousSession,
    customerSignal: SpecterCustomerSignal
  ): Promise<NudgeExecutionRequest | null> {
    const recommendation = await this.engine.generateRecommendation(
      shopId,
      session,
      customerSignal
    );
    if (!recommendation) return null;

    return {
      recommendation,
      sessionContext: session,
      customerContext: customerSignal,
      executionDeadline: new Date(Date.now() + 5000).toISOString()
    };
  }
}
```

Specter **never executes** the nudge. It only builds this request.

---

## 6. Latency & Degradation Contract

### 6.1 Latency Budget

```ts
// packages/specter/src/operations/degradation-manager.ts

export class DegradationManager {
  constructor(private readonly metrics: MetricsClient) {}

  async withLatencyBudget<T>(
    shopId: number,
    operation: () => Promise<T>,
    fallback: () => T
  ): Promise<T> {
    const start = Date.now();

    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('NudgeLatencyExceeded')), 100)
        )
      ]);
      const elapsed = Date.now() - start;
      this.metrics.recordHistogram('specter_nudge_latency_ms', elapsed, {
        shopId: String(shopId)
      });
      return result;
    } catch {
      this.metrics.incrementCounter('specter_nudge_latency_fallback', {
        shopId: String(shopId)
      });
      return fallback();
    }
  }

  getSafeFallbackNudge(session: AnonymousSession): NudgeExecutionRequest | null {
    if (!session.exitIntent) return null;

    const recommendation: NudgeRecommendation = {
      shopId: session.shopId,
      sessionId: session.sessionId,
      channel: 'onsite',
      nudgeType: 'REMINDER',
      offer: { type: 'NONE', value: 0, expiration: null, conditions: [] },
      messageKey: 'specter.fallback.reminder',
      reason: 'Fallback due to latency budget',
      expectedLift: 0.02,
      marginImpactEstimate: 0,
      confidence: 0.1
    };

    return {
      recommendation,
      sessionContext: session,
      executionDeadline: new Date(Date.now() + 5000).toISOString()
    };
  }
}
```

**Contract:**

* Intelligence path is **hard-bounded** at 100 ms.
* On timeout/error: Specter **never** returns a discount, only a gentle REMINDER or `null`.

---

## 7. Integration Contract (Phase 2 – LaSyncro-Aware)

These are **future-phase** but locked in design so OrderNexus/SKU OS can build against them later.

### 7.1 Module Presence

```ts
// packages/shared/src/modules/module-presence.ts

export interface ModulePresence {
  specter: boolean;
  finance: boolean;
  skuOs: boolean;
  wmsLite: boolean;
  echoHub: boolean;
  orderNexus: boolean; // new, default false if unknown
}
```

### 7.2 CustomerSignalResult & Fallback (Phase 2)

```ts
export interface CustomerSignalResult {
  signal: SpecterCustomerSignal;
  source: 'specter' | 'fallback' | 'default';
  confidence: number; // 0–1
  dataSources: {
    orderNexus: boolean;
    skuOs: boolean;
    finance: boolean;
  };
}
```

```ts
// packages/specter/src/resilience/specter-fallback-manager.ts

export class SpecterFallbackManager {
  async getCustomerSignalWithFallbacks(
    shopId: number,
    hashedCustomerId: string
  ): Promise<CustomerSignalResult> {
    const presence = await this.modulePresenceManager.getModulePresence(shopId);

    let signal = createDefaultCustomerSignal(shopId, hashedCustomerId);
    let source: CustomerSignalResult['source'] = 'default';
    let confidence = 0.1;

    if (presence.orderNexus) {
      try {
        const profitability =
          await this.orderNexusClient.getCustomerProfitability(
            shopId,
            hashedCustomerId
          );

        signal = this.enrichFromProfitability(signal, profitability);
        source = 'specter';
        confidence = 0.8;

        return {
          signal,
          source,
          confidence,
          dataSources: {
            orderNexus: true,
            skuOs: presence.skuOs,
            finance: presence.finance
          }
        };
      } catch {
        // fall through to local history
      }
    }

    const localData = await this.getLocalCustomerHistory(shopId, hashedCustomerId);
    if (localData) {
      signal = localData;
      source = 'fallback';
      confidence = 0.4;
    }

    return {
      signal,
      source,
      confidence,
      dataSources: {
        orderNexus: false,
        skuOs: presence.skuOs,
        finance: presence.finance
      }
    };
  }
}
```

### 7.3 Freshness Rule

```ts
export function shouldRecomputeSignal(
  specterSignal: SpecterCustomerSignal | null,
  orderNexusSnapshot: CustomerProfitabilitySnapshot | null
): boolean {
  if (!orderNexusSnapshot) return false;
  if (!specterSignal) return true;

  return new Date(orderNexusSnapshot.updatedAt) > new Date(specterSignal.updatedAt);
}
```

### 7.4 Future SpecterCustomerIntelligenceService (Integrated)

Later, the public service will internally use `SpecterFallbackManager` and `shouldRecomputeSignal`. But the **public signature stays the same**:

```ts
// stays stable – implementation evolves
async getCustomerSignal(shopId: number, hashedCustomerId: string | null)
  : Promise<SpecterCustomerSignal>;
```

---

## 8. Non-Goals & Explicit Exclusions (v1)

v1 **does not** include:

* Any discount logic (`offer.type` is always `'NONE'`)
* Customer tiers beyond `'UNKNOWN'`
* OrderNexus / SKU OS / Finance integration in production
* ML-based intent scoring or LTV prediction
* Complex data source auditing or reconciliation engines
* Mode-specific pricing / discount policies

Those belong to later phases. If someone adds them now, they are **out of contract**.

---

This is the locked blueprint:

* Minimal, enforceable contracts.
* PCD-safe by design.
* One clear HTTP entrypoint.
* One customer intelligence service.
* A trivial but safe nudge engine.
* A hard latency budget with safe degradation.
* A future integration shape that won’t break the CNS architecture.

If anyone builds something that violates these contracts, they’re not building Specter.

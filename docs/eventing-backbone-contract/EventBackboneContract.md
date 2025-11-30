Good, this is the glue that keeps everything from turning into micro-service spaghetti.

Below is the **LaSyncro Eventing Backbone Contract – v1 (Locked & Sealed)**.

---

# 🔒 0. Scope & Non-Negotiables

This document **locks**:

1. The **global event envelope** (shape every module must use)
2. **Naming & versioning** of event types
3. **Topic / routing rules** (how events are partitioned & consumed)
4. **Reliability model** (outbox, idempotency, DLQ)
5. Minimal **Event Bus API** and internal client semantics

Any deviation or change to the locked parts requires:

* `eventing-contract v2`
* Migration & coordination across all modules.

Transport details (Kafka vs SNS vs NATS) are implementation-specific; the **logical contract** below must hold regardless.

---

## 1. Event Taxonomy

We explicitly differentiate three categories (they all use the same envelope):

1. **Domain Events** – state changes other modules care about.

   * e.g. `RETURN_DECISION_V1`, `COST_MODEL_UPDATED_V1`

2. **Analytics Events** – firehose to InsightCore.

   * e.g. `ORDER_ANALYTICS_V1`, `RETURN_ANALYTICS_V1`, `WMS_ISSUE_ANALYTICS_V1`

3. **Operational Events** – system-level (billing, module registration).

   * e.g. `MODULE_PLAN_CHANGED_V1`

All three are routed through the **same backbone**, with clear typing.

---

## 2. Global Event Envelope (LOCKED)

Every event published on the backbone **must** be wrapped in this envelope:

```ts
// eventing/src/contracts/event-envelope.ts

export type EventCategory = 'domain' | 'analytics' | 'operational';

export interface EventEnvelope<TPayload = any> {
  // Globally unique event id
  eventId: string;               // UUID v4

  // High-level type with version suffix, e.g. 'RETURN_DECISION_V1'
  eventType: string;

  // Domain classification
  category: EventCategory;

  // Origin module
  sourceModule: ModuleKey;       // 'returnNexus' | 'skuOs' | 'wmsLite' | ...

  // Multi-tenant scoping
  shopId: ShopId | null;         // null allowed for global events (e.g. admin ops)

  // Entity focus (optional but recommended)
  entityType?: string;           // 'order', 'return', 'product', 'shop', ...
  entityId?: string;             // matching primary business id

  // Causality & tracing
  correlationId?: string;        // groups a chain of events
  causationId?: string;          // eventId of the direct parent
  traceId?: string;              // tracing system id

  // Temporal semantics
  occurredAt: string;            // ISO – when it happened in source module
  publishedAt: string;           // ISO – when it hit the bus

  // Versioning of payload schema
  schemaVersion: string;         // e.g. 'v1' to match *_V1

  // Actual business payload (typed by eventType on code side)
  payload: TPayload;
}
```

**Rules:**

* `eventId` MUST be globally unique.
* `eventType` MUST end with `_V1`, `_V2`, etc.
* `sourceModule` MUST be one of the locked `ModuleKey` enums.
* `shopId` MUST be set for all shop-specific events; only infra-level events may use `null`.

Any module publishing raw payloads without this envelope is **out of contract**.

---

## 3. Event Type Naming & Versioning

### 3.1 Naming Convention (LOCKED)

All event types follow:

```text
<DOMAIN_OBJECT>_<ACTION>_V<versionNumber>
```

Examples already defined in other blueprints:

* `RETURN_CASE_CREATED_V1`
* `RETURN_INSPECTION_COMPLETED_V1`
* `RETURN_DECISION_V1`
* `RETURN_ANALYTICS_V1`
* `ORDER_ANALYTICS_V1`
* `COST_MODEL_UPDATED_V1`
* `WMS_ISSUE_INTENT_V1`
* `PRODUCT_QUALITY_EVENT_V1`
* `MODULE_PLAN_CHANGED_V1`

### 3.2 Versioning Rules

* Changing **payload semantics** or **envelope contract** for a type requires:

  * New `eventType` with incremented version (e.g. `_V2`).
  * Old and new may coexist during migration.
* You **never** change the meaning of an existing `*_V1` type.

---

## 4. Topics & Routing (Logical Model)

We assume a topic-based pub/sub system. Logical topics are **locked** even if implementation names differ.

### 4.1 Topic Categories

```text
lasyncro.domain.v1          // domain events
lasyncro.analytics.v1       // analytics events
lasyncro.operational.v1     // operational/platform events
```

Within each:

* Partition key MUST be `shopId` (or a default when null), to:

  * Preserve order of events per shop (best-effort).
  * Limit cross-tenant bleed.

### 4.2 Routing Logic

* `category='domain'` → `lasyncro.domain.v1`
* `category='analytics'` → `lasyncro.analytics.v1`
* `category='operational'` → `lasyncro.operational.v1`

Consumers may additionally filter by:

* `eventType`
* `sourceModule`
* `shopId`

---

## 5. Producer Responsibilities (Outbox Pattern)

Each module is responsible for **reliable production** of events using an outbox table (like MarginCore already does).

### 5.1 Generic Outbox Schema (Per Module)

In each module DB:

```sql
CREATE TABLE <module>_outbox (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,            -- 'domain' | 'analytics' | 'operational'
  source_module TEXT NOT NULL,
  shop_id UUID,
  payload JSONB NOT NULL,            -- full EventEnvelope<>
  status TEXT NOT NULL               -- 'pending' | 'published' | 'failed'
    CHECK (status IN ('pending', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT
);

CREATE INDEX idx_<module>_outbox_pending
  ON <module>_outbox (status, created_at);
```

### 5.2 Producer Flow (LOCKED Semantics)

1. **Within same DB transaction** as business change:

   * Insert outbox row with `status='pending'`, `payload` being the full `EventEnvelope`.
2. **Outbox Worker** (per module):

   * Polls pending rows.
   * Publishes `payload` to the appropriate topic.
   * On success: `status='published'`.
   * On failure: increment `attempts`, write `last_error`, backoff.

After max attempts, may move to a **module-local DLQ** but the envelope shape stays the same.

---

## 6. Consumer Responsibilities

Any consumer of the event bus must:

### 6.1 Idempotency

* Derive a **consumer-local idempotency key** from `eventId`.
* Persist processed event IDs, or design processing to be idempotent by natural keys.
* Consumers MUST tolerate **at-least-once** delivery.

Minimum suggested schema (per module):

```sql
CREATE TABLE <module>_processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Before processing, check if `event_id` exists; if so, skip.

### 6.2 Ordering

* Ordering is only guaranteed per `(topic, partitionKey=shopId)`.
* Consumers MUST NOT assume global order across shops.
* If multiple consumers process in parallel, **business logic** must tolerate event reordering or patch with compensations.

---

## 7. Required Events Per Module (v1)

These are already defined in your previous blueprints, but we clarify **how they ride on the backbone**.

### 7.1 ReturnNexus

**Domain Events (category='domain'):**

* `RETURN_DECISION_V1`

  * payload = `ReturnDecisionEvent` (from ReturnNexus blueprint)
* `RETURN_OUTCOME_V1`

  * payload = `ReturnOutcomeEvent` (for OrderNexus)

**Analytics Events (category='analytics'):**

* `RETURN_ANALYTICS_V1`

  * payload = `ReturnAnalyticsEvent` (for InsightCore & SKU OS)

### 7.2 WMS-Lite

**Domain → ProblemSolve / ReturnNexus / SKU OS:**

* `WMS_ISSUE_INTENT_V1`

  * payload = `WmsIssueIntentEvent`
* `RETURN_INSPECTION_COMPLETED_V1`

  * payload = `ReturnInspectionEvent`

### 7.3 ProblemSolve

**Domain / Analytics / Operational:**

* `PRODUCT_QUALITY_EVENT_V1` (category='domain')

  * payload = `ProductQualityEvent` → SKU OS
* `RETURN_QUALITY_CONTEXT_V1` (category='domain')

  * payload = `ReturnQualityContextEvent` → ReturnNexus
* `ISSUE_TASK_PAYLOAD_V1` (category='domain')

  * payload = `IssueTaskPayload` → Echo Hub
* `WMS_ISSUE_ANALYTICS_V1` (category='analytics')

  * payload = `WmsIssueAnalyticsEvent` → InsightCore

### 7.4 SKU OS

**Analytics:**

* `PRODUCT_HEALTH_ANALYTICS_V1`

  * payload = `ProductHealthAnalyticsEvent` → InsightCore

### 7.5 OrderNexus

**Analytics:**

* `ORDER_ANALYTICS_V1`

  * payload = `OrderAnalyticsEvent` → InsightCore

**Domain:**

* Future: `ORDER_COMPLETED_V1`, `ORDER_RETURNED_V1` to SKU OS, etc., as already spec’d.

### 7.6 MarginCore

**Domain:**

* `COST_MODEL_UPDATED_V1`

  * payload: `{ version: 1, shopId, costModelVersion: CostModelVersioning }`
    (already seen in MarginCore blueprint — now it rides in the envelope)

### 7.7 Specter

**Analytics:**

* `NUDGE_ANALYTICS_V1`

  * payload = `NudgeAnalyticsEvent` → InsightCore

### 7.8 InsightCore

InsightCore is mostly a **consumer** for analytics events. It may publish **operational** events later (e.g. anomaly detection), but v1 doesn’t require it.

### 7.9 Core / Billing / Entitlements

**Operational:**

* `MODULE_PLAN_CHANGED_V1`

  * Source: Billing
  * Payload: `{ shopId, moduleKey, oldPlanId, newPlanId, changedAt }`
* `MODULE_STATUS_CHANGED_V1`

  * Source: Core
  * Payload: `{ shopId, moduleKey, oldStatus, newStatus, changedAt }`

These are useful for recalculating entitlements, recalibrating UIs, etc.

---

## 8. Event Bus API (Internal Service Layer)

We define a minimal **EventBus** interface that all modules must use, regardless of actual underlying implementation.

```ts
// eventing/src/interfaces/event-bus.ts

export interface EventBus {
  publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void>;

  // For dynamic consumers; static consumers should use module-specific libs
  subscribe(
    topic: string,
    handler: (event: EventEnvelope<any>) => Promise<void>,
    options?: {
      consumerGroup?: string;
      filterByEventType?: string[];
      filterBySourceModule?: ModuleKey[];
    }
  ): Promise<void>;
}
```

**Rules:**

* `publish` MUST not block business transactions; use outbox.
* `subscribe` MUST be used inside long-running workers or stream processors.

---

## 9. Security & Multi-Tenancy

* `shopId` MUST be present in envelope for all tenant-bound events.
* Downstream services **must** enforce that they only access data scoped to that `shopId`.
* No event may include **PII beyond what’s allowed by module PCD policies** (e.g. Specter’s RawSession restrictions).

Event payloads must respect each module’s privacy guarantees.

---

## 10. Observability & DLQ

### 10.1 Backbone Metrics (per topic)

```ts
const EVENTING_METRICS = {
  publish: {
    events_published_total: 'Counter',       // labels: topic, sourceModule, eventType
    publish_failures_total: 'Counter'        // labels: topic, sourceModule, eventType
  },
  consume: {
    events_consumed_total: 'Counter',        // labels: topic, consumerGroup, eventType
    events_failed_total: 'Counter',          // labels: topic, consumerGroup, eventType
    handler_latency_ms: 'Histogram'          // latency per handler invocation
  }
};
```

### 10.2 Dead-Letter Queues

Each consumer group must have a DLQ:

* `lasyncro.domain.v1.dlq.<consumerGroup>`
* `lasyncro.analytics.v1.dlq.<consumerGroup>`
* `lasyncro.operational.v1.dlq.<consumerGroup>`

When a consumer cannot process an event after N retries:

* It forwards the **full EventEnvelope** to the DLQ.
* It increments `events_failed_total`.
* Alerting is set up on DLQ traffic.

---

## 11. Forbidden Shortcuts & Anti-Patterns

**Not allowed in v1:**

* Services calling each other synchronously for information that should be event-driven, when an event exists and is contractually defined.
* Publishing raw JSON payloads to topics without the global envelope.
* Reusing an existing `eventType` name with a different payload shape.
* Adding PII to event payloads in violation of module privacy contracts (e.g., Specter’s RawSession rules).
* Consuming from topics and mutating cross-tenant data without checking `shopId`.

Any such behavior breaks the CNS model and must be treated as a contract violation.
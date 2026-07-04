import crypto from 'crypto';
import { Decision, DecisionType } from './Decision.js';

/**
 * DECISION SIGNAL CONTRACT (V1)
 * ----------------------------
 * Explicit contract for inputs to Decision Engine.
 *
 * Prevents:
 * - hidden coupling
 * - unsafe "any" usage
 * - silent schema drift
 *
 * NOTE:
 * Still tied to risk snapshot (to be abstracted later),
 * but now fully type-safe.
 */
type DecisionSignals = {
  order_health_score: number;
  aging_risk_component: number;
  sla_risk_component: number;
  inventory_risk_component: number;
  customer_risk_component: number;
  operational_risk_component: number;

  is_inventory_blocked: boolean;
  is_customer_blocked: boolean;
  is_operational_blocked: boolean;

  inventory_blocked_revenue?: number;
  is_already_fulfilled: boolean;
  // optional future-safe fields
  [key: string]: unknown;
};

function calculateDecisionPriority(signals: DecisionSignals): number {
  /**
   * WEIGHTED PRIORITY MODEL (V1)
   * ----------------------------
   * Combines multiple risk dimensions into a single comparable score.
   *
   * Goals:
   * - reflect true operational urgency
   * - remain deterministic
   * - stay explainable
   *
   * Range target: 0–100
   */

  const healthComponent = 100 - signals.order_health_score;

  const agingWeight = 0.25;
  const slaWeight = 0.25;
  const inventoryWeight = 0.2;
  const customerWeight = 0.15;
  const operationalWeight = 0.15;

  const weightedRisk =
    signals.aging_risk_component * agingWeight +
    signals.sla_risk_component * slaWeight +
    signals.inventory_risk_component * inventoryWeight +
    signals.customer_risk_component * customerWeight +
    signals.operational_risk_component * operationalWeight;

  /**
   * FINAL PRIORITY
   * --------------
   * Combine baseline (health inversion) with weighted signals.
   * Clamp to safe bounds.
   */
  const priority = Math.max(
    0,
    Math.min(100, Math.round(healthComponent * 0.5 + weightedRisk * 0.5))
  );

  return priority;
}

/**
 * DECISION TYPE DERIVATION (ENGINE-OWNED)
 * --------------------------------------
 */
function deriveDecisionType(signals: DecisionSignals): DecisionType {
  /**
   * DECISION TYPE CLASSIFICATION (V2)
   * --------------------------------
   * Explicit mapping based on active signal domains.
   *
   * Goals:
   * - extensible for new domains (financial, fraud, etc.)
   * - deterministic
   * - transparent logic
   */

  const hasOperationalBlock =
    signals.is_inventory_blocked ||
    signals.is_customer_blocked ||
    signals.is_operational_blocked;

  /**
   * FUTURE: financial signals
   * (placeholder for upcoming expansion)
   */
  const hasFinancialRisk =
    (signals as any).financial_risk_component !== undefined &&
    (signals as any).financial_risk_component > 0;

  if (hasOperationalBlock) {
    return 'operational';
  }

  if (hasFinancialRisk) {
    return 'financial';
  }

  return 'risk';
}

/**
 * VALIDATION (ENGINE-OWNED)
 * -------------------------
 * Central enforcement to prevent corrupted decisions
 */
function assertValidDecisionAction(action: any, path: string) {
  if (!action || typeof action !== 'object') {
    throw new Error(`[DECISION_ACTION_INVALID] ${path} must be object`);
  }

  if (typeof action.type !== 'string') {
    throw new Error(`[DECISION_ACTION_INVALID] ${path}.type must be string`);
  }

  if (typeof action.payload !== 'object' || action.payload === null) {
    throw new Error(`[DECISION_ACTION_INVALID] ${path}.payload must be object`);
  }

  if (!['manual', 'automated'].includes(action.execution_mode)) {
    throw new Error(
      `[DECISION_ACTION_INVALID] ${path}.execution_mode invalid: ${action.execution_mode}`
    );
  }
}

function assertNoStringifiedJson(obj: unknown, path = 'root') {
  if (typeof obj === 'string') {
    const trimmed = obj.trim();

    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      throw new Error(
        `[DECISION_INVALID_STRUCTURE] ${path} contains stringified JSON`
      );
    }

    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, i) =>
      assertNoStringifiedJson(item, `${path}[${i}]`)
    );
    return;
  }

  if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      assertNoStringifiedJson(value, `${path}.${key}`);
    }
  }
}

/**
 * DECISION BUILDER (ATOMIC UNIT)
 * ------------------------------
 * Responsible for:
 * - deterministic ID generation (per action)
 * - validation
 * - structural integrity
 */
function buildDecision({
  orderId,
  shopId,
  aggregateVersion,
  signals,
  action
}: {
  orderId: string;
  shopId: number;
  aggregateVersion: number;
  signals: DecisionSignals;
  action: any;
}): Decision {

    /**
     * STABLE PAYLOAD STRINGIFICATION
     * ------------------------------
     * Ensures deterministic hashing regardless of key order.
     */
    function stableStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        return `[${obj.map(stableStringify).join(',')}]`;
    }

    return `{${Object.keys(obj)
        .sort()
        .map((key) => `"${key}":${stableStringify((obj as any)[key])}`)
        .join(',')}}`;
    }

  const decisionId = crypto
    .createHash('sha256')
    .update(
        `decision:${orderId}:${aggregateVersion}:${action.type}:${stableStringify(action.payload)}`
    )
    .digest('hex')
    .slice(0, 32);

  const actions = [action];

  /**
   * VALIDATION (MANDATORY BEFORE RETURN)
   */
  assertValidDecisionAction(action, 'recommended_action');
  assertValidDecisionAction(action, 'actions[0]');

  assertNoStringifiedJson(action, 'recommended_action');
  assertNoStringifiedJson(actions, 'actions');

  return {
    id: decisionId,
    type: deriveDecisionType(signals),
    entity_id: orderId,
    shop_id: shopId,
    aggregate_version: aggregateVersion,
    priority: calculateDecisionPriority(signals),

    score_breakdown: {
      health: signals.order_health_score,
      aging: signals.aging_risk_component,
      sla: signals.sla_risk_component,
      inventory: signals.inventory_risk_component,
      customer: signals.customer_risk_component,
      operational: signals.operational_risk_component
    },

    reason: `Derived from ${action.type}`,

    signals: {
      inventory_blocked: signals.is_inventory_blocked,
      customer_blocked: signals.is_customer_blocked,
      operational_blocked: signals.is_operational_blocked,
      health_score: signals.order_health_score
    },

    recommended_action: action,
    actions,

    status: 'pending',

    /**
     * LIFECYCLE METADATA (V1)
     * ----------------------
     * Enables:
     * - execution tracking
     * - resolution tracking
     * - future state transitions
     */
    lifecycle: {
        started_at: null,
        resolved_at: null,
        outcome: null // 'success' | 'failure' | null
    },

    created_at: new Date(),
    updated_at: new Date()
  };
}

/**
 * SIGNAL MAPPER (DECOUPLING LAYER)
 * --------------------------------
 * Converts external projections → DecisionSignals.
 *
 * This isolates the engine from:
 * - projection schema changes
 * - single-source dependency
 *
 * Future:
 * - can merge multiple sources here
 */
function mapToDecisionSignals(input: any): DecisionSignals {
  return {
    order_health_score: input.order_health_score,
    aging_risk_component: input.aging_risk_component,
    sla_risk_component: input.sla_risk_component,
    inventory_risk_component: input.inventory_risk_component,
    customer_risk_component: input.customer_risk_component,
    operational_risk_component: input.operational_risk_component,

    is_inventory_blocked: input.is_inventory_blocked,
    is_customer_blocked: input.is_customer_blocked,
    is_operational_blocked: input.is_operational_blocked,
    inventory_blocked_revenue: input.inventory_blocked_revenue,
    is_already_fulfilled: input.is_already_fulfilled ?? false
  };
}

/**
 * DECISION ENGINE (MULTI-DECISION)
 * --------------------------------
 * Produces independent decisions per constraint domain.
 *
 * Guarantees:
 * - no signal loss
 * - composable decisions
 * - deterministic output
 */
export function generateDecisions({
  orderId,
  shopId,
  aggregateVersion,
  riskSnapshot,
}: {
  orderId: string;
  shopId: number,
  aggregateVersion: number;
  riskSnapshot: DecisionSignals;
}): Decision[] {

const decisions: Decision[] = [];
const signals = mapToDecisionSignals(riskSnapshot);

const isReplay =
  signals?.aggregate_version !== undefined &&
  aggregateVersion === signals.aggregate_version;

if (!isReplay) {
  console.info('[DECISION_ENGINE_START]', {
    orderId,
    aggregateVersion,
    hasRiskSnapshot: !!riskSnapshot
  });
}

  /**
   * INVENTORY DECISION
   */
  if (signals.is_inventory_blocked) {
    const decision = buildDecision({
        orderId,
        shopId,
        aggregateVersion,
        signals,
        action: {
            type: 'resolve_inventory_block',
            payload: {
            blocked_revenue: signals.inventory_blocked_revenue
            },
            execution_mode: 'manual'
        }
        });

        if (!isReplay) {
            console.info('[DECISION_CREATED]', {
                orderId,
                decisionId: decision.id,
                type: decision.type,
                action: decision.recommended_action.type,
                priority: decision.priority,
                source: 'inventory_block',
            });
        }

        decisions.push(decision);
  }

 /**
 * CUSTOMER DECISION
 */
if (signals.is_customer_blocked) {
  const decision = buildDecision({
    orderId,
    shopId,
    aggregateVersion,
    signals,
    action: {
      type: 'resolve_customer_block',
      payload: {},
      execution_mode: 'manual'
    }
  });

        if (!isReplay) {
            console.info('[DECISION_CREATED]', {
                orderId,
                decisionId: decision.id,
                type: decision.type,
                action: decision.recommended_action.type,
                priority: decision.priority,
                source: 'customer_block',
            });
        }

  decisions.push(decision);
}

/**
 * OPERATIONAL DECISION
 */
if (signals.is_operational_blocked) {
  const decision = buildDecision({
    orderId,
    shopId,
    aggregateVersion,
    signals,
    action: {
      type: 'resolve_operational_block',
      payload: {},
      execution_mode: 'manual'
    }
  });
  
        if (!isReplay) {
            console.info('[DECISION_CREATED]', {
                orderId,
                decisionId: decision.id,
                type: decision.type,
                action: decision.recommended_action.type,
                priority: decision.priority,
                source: 'operational_block',
            });
        }

  decisions.push(decision);
}

/**
 * SAFE FULFILLMENT GATE (CRITICAL)
 * --------------------------------
 * Prevents blind auto-fulfillment.
 *
 * REQUIREMENTS:
 * - No blockers
 * - Explicit readiness signal (future: inventory/payment/etc.)
 *
 * CURRENT:
 * - Only allow fulfillment if order_health_score is high
 */
if (decisions.length === 0) {

  const isSafeToFulfill =
    signals.order_health_score >= 80 &&
    !signals.is_inventory_blocked &&
    !signals.is_customer_blocked &&
    !signals.is_operational_blocked &&
    !signals.is_already_fulfilled;

  if (!isSafeToFulfill) {
    console.warn('[FULFILLMENT_BLOCKED_UNSAFE_DEFAULT]', {
      orderId,
      signals
    });

    return decisions;
  }

  const decision = buildDecision({
    orderId,
    shopId,
    aggregateVersion,
    signals,
    action: {
      type: 'proceed_fulfillment',
      payload: {},
      /**
       * EXECUTION MODE (PHASE 1 — MANUAL)
       * ---------------------------------
       * System produces decisions only.
       * Execution must be explicitly triggered by user.
       */
      execution_mode: 'manual'
    }
  });

  if (!isReplay) {
    console.info('[DECISION_CREATED]', {
      orderId,
      decisionId: decision.id,
      type: decision.type,
      action: decision.recommended_action.type,
      priority: decision.priority,
      source: 'safe_fallback'
    });
  }

  decisions.push(decision);
}

if (!isReplay) {
  console.info('[DECISION_ENGINE_RESULT]', {
    orderId,
    decisionCount: decisions.length
  });
}

  return decisions;
}
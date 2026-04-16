/**
 * Signal Registry
 * ---------------
 *
 * Central registry mapping operational states
 * to signal builder execution logic.
 *
 * This removes large conditional blocks from the mapper
 * and turns the mapper into a deterministic orchestrator.
 */

import type { OperationalSignal } from '../../../contracts/operationalSignals.js';
import type { OperationalControlSnapshot } from '../types/operationalControlSnapshot.js';
import type { OperationalStates } from '../detectOperationalStates.js';
import {
  registerSignalType,
  getDetectedAt,
  getLifecycle
} from '../lifecycle/signalLifecycleEngine.js';

import { signalId } from '../utils/signalUtils.js';

import { createInventoryConstraintClusterSignal } from './createInventoryConstraintClusterSignal.js';
import { createSlaRiskSignal } from './createSlaRiskSignal.js';
import { createPaymentReviewSignal } from './createPaymentReviewSignal.js';
import { createAwaitingCustomerSignal } from './createAwaitingCustomerSignal.js';
import { createOperationalExceptionSignal } from './createOperationalExceptionSignal.js';
import { createPaymentProblemSignal } from './createPaymentProblemSignal.js';
import { createEarlyAgingSignal, createAgingOrdersSignal } from './createAgingSignals.js';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

export type SignalExecutionContext = {
  snapshot: OperationalControlSnapshot;
  states: OperationalStates;
  evaluationTime: number;
  activeSignalTypes: Set<string>;
  /** CURRENCY LAYER 3 — passed from OrdersModuleFT2 props */
  currency?: CurrencyContext;
};

type SignalRegistryEntry = {
  id: string;
  shouldEmit: (states: OperationalStates) => boolean;
  build: (
    ctx: SignalExecutionContext,
    detectedAt: string,
    currency?: CurrencyContext,
  ) => OperationalSignal;
};

export const signalRegistry: SignalRegistryEntry[] = [

  {
    id: 'inventory-constraint-cluster',
    shouldEmit: (s) => s.inventoryConstraintCluster,
    build: (ctx, detectedAt) =>
      createInventoryConstraintClusterSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'critical',
        signalId('inventory-constraint-cluster')
      )
  },

  {
    id: 'sla-risk',
    shouldEmit: (s) => s.slaRisk,
    build: (ctx, detectedAt) =>
      createSlaRiskSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'critical',
        signalId('sla-risk')
      )
  },

  {
    id: 'payment-review',
    shouldEmit: (s) => s.paymentReview,
    build: (ctx, detectedAt) =>
      createPaymentReviewSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'warning',
        signalId('payment-review')
      )
  },

  {
    id: 'awaiting-customer',
    shouldEmit: (s) => s.awaitingCustomer,
    build: (ctx, detectedAt) =>
      createAwaitingCustomerSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'info',
        signalId('awaiting-customer')
      )
  },

  {
    id: 'operational-exception',
    shouldEmit: (s) => s.operationalException,
    build: (ctx, detectedAt) =>
      createOperationalExceptionSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'critical',
        signalId('operational-exception'),
        ctx.currency
      )
  },

  {
    id: 'payment-retry',
    shouldEmit: (s) => s.paymentProblem,
    build: (ctx, detectedAt) =>
      createPaymentProblemSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'critical',
        signalId('payment-retry'),
        ctx.currency
      )
  },

  {
    id: 'aging-24h',
    shouldEmit: (s) => s.earlyAging,
    build: (ctx, detectedAt) =>
      createEarlyAgingSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'info',
        signalId('aging-24h')
      )
  },

  {
    id: 'aging-orders',
    shouldEmit: (s) => s.agingOrders,
    build: (ctx, detectedAt) =>
      createAgingOrdersSignal(
        ctx.snapshot,
        detectedAt,
        getLifecycle(),
        'critical',
        signalId('aging-orders')
      )
  }
];
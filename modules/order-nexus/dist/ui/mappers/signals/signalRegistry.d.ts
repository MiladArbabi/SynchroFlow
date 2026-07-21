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
    build: (ctx: SignalExecutionContext, detectedAt: string, currency?: CurrencyContext) => OperationalSignal;
};
export declare const signalRegistry: SignalRegistryEntry[];
export {};

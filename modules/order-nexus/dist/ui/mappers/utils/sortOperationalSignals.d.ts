/**
 * Signal Ordering
 * ----------------
 *
 * Deterministic ordering for the Operations Queue.
 *
 * Priority rules:
 *
 * 1. severity
 * 2. signal age
 * 3. deterministic id
 */
import type { OperationalSignal } from '../../../contracts/operationalSignals.js';
export declare function sortOperationalSignals(signals: OperationalSignal[]): OperationalSignal[];

/**
 * Snapshot Normalization
 * ----------------------
 *
 * Ensures snapshot metrics are:
 * - numeric
 * - non-negative
 * - within operational bounds
 *
 * Prevents malformed resolver input from
 * corrupting the operational signal engine.
 */
import type { OperationalControlSnapshot } from '../types/operationalControlSnapshot.js';
export declare function normalizeOperationalSnapshot(snapshot: OperationalControlSnapshot): OperationalControlSnapshot;

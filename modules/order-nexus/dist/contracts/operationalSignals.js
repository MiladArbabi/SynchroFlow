/**
 * Operational Signal Contract
 * ---------------------------
 *
 * Defines the canonical structure for signals shown in the
 * Operations Queue surface of the Orders FT2 module.
 *
 * Purpose
 * -------
 * Decouple backend snapshot fields from UI rendering logic.
 *
 * This contract enables:
 *
 *  - progressive disclosure
 *  - inline actions
 *  - batch actions
 *  - consistent signal severity handling
 *
 * Data lineage
 * ------------
 *
 * DB snapshots
 * ↓
 * FT2 resolver
 * ↓
 * OperationalSignal[]
 * ↓
 * OperationalSignalsSection
 */
export {};
//# sourceMappingURL=operationalSignals.js.map
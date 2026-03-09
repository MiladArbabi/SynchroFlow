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
 * OperationsQueueSection
 */

export type OperationalSignalSeverity =
  | 'critical'
  | 'warning'
  | 'info';

export type OperationalSignalAction = {
  id: string;

  /**
   * Label shown in UI.
   */
  label: string;

  /**
   * Action identifier used by UI handlers.
   */
  actionType: string;
};

export type OperationalSignal = {
  /**
   * Unique signal identifier
   */
  id: string;

  /**
   * Severity determines icon and color.
   */
  severity: OperationalSignalSeverity;

  /**
   * Short operational problem description.
   */
  title: string;

  /**
   * Human readable impact description.
   *
   * Example:
   * "5 orders blocked"
   */
  impact: string;

  /**
   * Optional financial or operational impact.
   *
   * Example:
   * "$742 revenue at risk"
   */
  impactDetail?: string;

  /**
   * Optional signal metadata for progressive disclosure.
   *
   * Example:
   * affected SKUs or order ids.
   */
  metadata?: Record<string, unknown>;

    /**
     * Inline actions for a single signal instance.
     */
    actions?: OperationalSignalAction[];

    /**
     * Batch actions affecting multiple underlying entities.
     *
     * Example:
     * Print labels
     * Mark shipped
     */
    batchActions?: OperationalSignalAction[];
};
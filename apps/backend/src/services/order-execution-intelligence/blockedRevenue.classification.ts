/**
 * L2 — Blocked Revenue Classification
 * ----------------------------------
 * Internal intelligence only.
 *
 * Purpose:
 * - Classify blocked revenue by obligation type
 * - Preserve full expressiveness
 *
 * NOT exposed to FT2.
 * NOT downgraded here.
 */
export type BlockedRevenueClassification = {

  /**
   * NOTE (Obligation v1):
   * --------------------
   * Customer and Operational obligations do NOT exist
   * until explicit evaluation signals are written.
   *
   * Absence of evaluation ≠ no obligation.
   * Absence MUST propagate as NULL through FT2.
   */

  /**
   * Economic Source Constraint
   * --------------------------
   * totalBlockedValue MUST be derived from:
   *   order_revenue_units (quantity × unit_revenue)
   *
   * It MUST NOT be derived from:
   *   orders.total_price
   *
   * Reason:
   * - Order-level totals ignore partial refunds
   * - Ignore returned quantities
   * - Ignore SKU-level blocking
   *
   * This classification layer assumes
   * revenue-unit–based aggregation upstream.
   */

  totalBlockedValue: number;

  buckets: {
    inventory?: number;
    customer?: number;
    operational?: number;
    other?: number;
  };

  /**
    * Customer Obligation v2 — Coverage-only (Non-activating)
    * ------------------------------------------------------
    * Customer payment state may be observable,
    * but NO blocking semantics exist yet.
    *
    * Coverage MUST NOT imply attribution.
   * ----------------------------------------
   * No customer payment / settlement / liability
   * primitive exists in orders.
   *
   * As of this version:
   * - Customer obligation CANNOT be evaluated
   * - CANNOT be inferred
   * - CANNOT be approximated
   *
   * This is a hard schema constraint, not a logic gap.
   *
   * Any future customer obligation requires:
   * - New canonical column(s)
   * - Explicit migration
   * - Versioned obligation upgrade
   */

  coverage: {
    /**
     * % of blocked revenue whose obligation
     * category is known (any bucket).
     *
     * NOTE:
     * - Classification is stricter than coverage
     * - Coverage alone MUST NOT imply attribution
     */
    classifiedPct: number;

    /**
     * Inventory obligation coverage
     * -----------------------------
     * % of blocked revenue whose line items
     * had sufficient inventory truth to evaluate.
     *
     * Epistemic coverage ONLY.
     * Evaluation ≠ attribution.
     */
    inventoryCoveragePct: number;

    /**
     * Customer obligation coverage (v2)
     * ---------------------------------
     * % of blocked revenue whose payment state
     * is factually observable.
     *
     * IMPORTANT:
     * - Coverage ≠ customer blockage
     * - Absence of coverage MUST block classification
     */
    customerCoveragePct?: number;

    /**
     * Blocked revenue with no obligation attribution.
     *
     * MUST be > 0 when classifiedPct < 1
     */
    unknownValue: number;
  };
};

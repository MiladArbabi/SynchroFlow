export interface CustomersFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /**
   * ─────────────────────────────────────
   * Domain 1 — Identity Presence Reality
   * ─────────────────────────────────────
   *
   * Meaning:
   * - null → customer table not observable
   * - >0   → at least one customer entity exists
   * - 0    → explicitly zero customers (non-collapsed)
   *
   * Constraints:
   * - Existence-only
   * - No identity quality assessment
   */
  customersObserved: number | null;

 /**
   * ─────────────────────────────────────
   * Domain 2 — Activity Presence Reality
   * ─────────────────────────────────────
   *
   * Meaning:
   * - null  → customer activity not observable
   * - true  → at least one customer created in period
   * - false → explicitly zero customer creation events
   *
   * Constraints:
   * - Existence-only
   * - Customer creation is the activity proxy
   * - No behavioral interpretation
   */
  activityObserved: boolean | null;

  extractedAt: string;
}

/**
 * Customers Facts Input (FT2)
 * ---------------------------
 * Canonical read contract.
 *
 * Rules:
 * - shopId is authoritative (resolved upstream)
 * - period is mandatory and enforced server-side
 * - No optional fields (avoid hidden defaults)
 */
export interface GetCustomersFactsInput {
  shopId: number;

  period: {
    from: string; // ISO timestamp
    to: string;   // ISO timestamp
  };
}

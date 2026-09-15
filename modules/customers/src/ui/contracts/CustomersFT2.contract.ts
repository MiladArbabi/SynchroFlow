/**
 * Customers FT2 — Public Contract
 * --------------------------------
 * Runtime-exported contract.
 *
 * IMPORTANT:
 * - Must exist at runtime for ESM analyzers (Vite/Rollup)
 * - Shape remains stable for Customers FT2 consumers
 * - No logic, no defaults, no semantics
 */
export type CustomersFT2Contract = {
  context: {
    period: {
      from: string;
      to: string;
    };
    sessionsPresent: boolean | null;
  };

  activityDirection:
    | 'up'
    | 'down'
    | 'flat'
    | 'unknown'
    | null;

  signals: {
    exitIntentDetected: boolean | null;
    funnelsDetected: boolean | null;
    multiStepSessionsPresent: boolean | null;
    surfaceBreadthPresent: boolean | null;
    returningSessionsPresent: boolean | null;
    exitWithoutInteractionPresent: boolean | null;
    averageSessionDepthPresent: boolean | null;
  };

  dataCoverage:
    | 'complete'
    | 'insufficient'
    | null;
};

/**
 * Runtime anchor.
 *
 * This exists solely to ensure the contract is a real ESM export.
 * Do NOT use at runtime.
 */
export const CustomersFT2Contract = null as unknown as CustomersFT2Contract;

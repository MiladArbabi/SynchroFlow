/**
 * CustomersModule — FT1 Diagnostic Surface
 * ---------------------------------------
 * Purpose:
 * - Provide a truthful, non-inferential diagnostic state for Customers.
 *
 * FT1 Invariants:
 * - No customer intelligence
 * - No insights, trends, or value claims
 * - No onboarding orchestration
 * - Read-only, factual messaging only
 *
 * If this file starts explaining or advising, FT1 is broken.
 */
export interface CustomersModuleProps {
    sessionsObserved: number | null;
}
export default function CustomersModule(props: CustomersModuleProps): import("react").JSX.Element;

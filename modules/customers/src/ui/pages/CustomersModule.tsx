// modules/customers/src/ui/pages/CustomersModule.tsx

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

export default function CustomersModule(
  props: CustomersModuleProps
) {
  console.debug('[FT1][Customers][CustomersModule] props', props);

  if (props.sessionsObserved === null) {
    return (
      <section data-testid="customers-ft1-loading">
        <strong>Analyzing customer sessions…</strong>
        <div>Session data is being validated.</div>
      </section>
    );
  }

  if (props.sessionsObserved === 0) {
    return (
      <section data-testid="customers-ft1-no-sessions">
        <strong>No customer sessions detected yet</strong>
        <div>
          We haven’t observed any customer sessions for this store.
        </div>
      </section>
    );
  }

  return (
    <section data-testid="customers-ft1-ready">
      <strong>Customer sessions detected</strong>
      <div>
        {props.sessionsObserved} sessions observed so far.
      </div>
    </section>
  );
}
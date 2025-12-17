//apps/frontend/src/pages/FinancesPage.tsx
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function FinancesPage() {
  return (
    <CommerceActivationGate moduleId="finances">
      <section data-testid="finances-host-ui">
        <h1>Finances</h1>
        <p>Status: syncing</p>
      </section>
    </CommerceActivationGate>
  );
}

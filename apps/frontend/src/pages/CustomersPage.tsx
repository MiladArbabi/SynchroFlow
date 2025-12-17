// apps/frontend/src/pages/CustomersPage.tsx
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function CustomersPage() {
  return (
    <CommerceActivationGate moduleId="customers">
      <section data-testid="customers-host-ui">
        <h1>Customers</h1>
        <p>Status: syncing</p>
      </section>
    </CommerceActivationGate>
  );
}
//apps/frontend/src/pages/AnalyticsPage.tsx
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function AnalyticsPage() {
  return (
    <CommerceActivationGate moduleId="analytics">
      <section data-testid="analytics-host-ui">
        <h1>Analytics</h1>
        <p>Status: syncing</p>
      </section>
    </CommerceActivationGate>
  );
}

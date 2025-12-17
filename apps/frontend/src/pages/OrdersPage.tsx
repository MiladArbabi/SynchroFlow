import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function OrdersPage() {
  return (
    <CommerceActivationGate moduleId="order-nexus">
      <section data-testid="orders-host-ui">
        <h1>Orders</h1>
        <p>Status: syncing</p>
      </section>
    </CommerceActivationGate>
  );
}

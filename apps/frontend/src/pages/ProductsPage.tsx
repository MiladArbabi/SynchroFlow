import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function ProductsPage() {
  return (
    <CommerceActivationGate moduleId="products">
      <section data-testid="products-host-ui">
        <h1>Products</h1>
        <p>Status: syncing</p>
      </section>
    </CommerceActivationGate>
  );
}
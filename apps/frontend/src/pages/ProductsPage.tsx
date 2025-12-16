import React from 'react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function ProductsPage() {
  return (
    <CommerceActivationGate moduleId="products">
      <div>Products module is Under Construction.</div>
    </CommerceActivationGate>
  );
}

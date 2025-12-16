// apps/frontend/src/pages/CustomersPage.tsx
import React from 'react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function CustomersPage() {
  return (
    <CommerceActivationGate moduleId="customers">
      <div>Customers module is Under Construction.</div>
    </CommerceActivationGate>
  );
}
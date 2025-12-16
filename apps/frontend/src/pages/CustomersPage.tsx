// apps/frontend/src/pages/CustomersPage.tsx
import React from 'react';
import { CommerceFT1Gate } from 'activation/FT1ActivationGate';

export default function CustomersPage() {
  return (
    <CommerceFT1Gate moduleId="customers">
      <div>Customers module is Under Construction.</div>
    </CommerceFT1Gate>
  );
}
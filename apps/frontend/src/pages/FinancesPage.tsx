//apps/frontend/src/pages/FinancesPage.tsx
import React from 'react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function FinancesPage() {
  return (
    <CommerceActivationGate moduleId="finances">
      <div>Finances module is Under Construction.</div>
    </CommerceActivationGate>
  );
}
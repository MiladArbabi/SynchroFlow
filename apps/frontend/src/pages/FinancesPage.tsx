//apps/frontend/src/pages/FinancesPage.tsx
import React from 'react';
import { CommerceFT1Gate } from 'activation/FT1ActivationGate';

export default function FinancesPage() {
  return (
    <CommerceFT1Gate moduleId="finances">
      <div>Finances module is Under Construction.</div>
    </CommerceFT1Gate>
  );
}
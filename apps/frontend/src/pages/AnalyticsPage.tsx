//apps/frontend/src/pages/AnalyticsPage.tsx
import React from 'react';
import { CommerceFT1Gate } from 'activation/FT1ActivationGate';

export default function AnalyticsPage() {
  return (
    <CommerceFT1Gate moduleId="analytics">
      <div>Analytics module is Under Construction.</div>
    </CommerceFT1Gate>
  );
}
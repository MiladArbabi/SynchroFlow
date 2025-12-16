//apps/frontend/src/pages/AnalyticsPage.tsx
import React from 'react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function AnalyticsPage() {
  return (
    <CommerceActivationGate moduleId="analytics">
      <div>Analytics module is Under Construction.</div>
    </CommerceActivationGate>
  );
}
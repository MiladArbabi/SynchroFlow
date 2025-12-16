import React from 'react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function OrdersPage() {
  return (
    <CommerceActivationGate moduleId="order-nexus">
      <div>Orders module is Under Construction.</div>
    </CommerceActivationGate>
  );
};
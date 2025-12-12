import React from 'react';
import ModuleHost from 'runtime/ModuleHost';

export default function OrdersPage() {
  return <ModuleHost moduleId="order-nexus" route="/orders" />;
}

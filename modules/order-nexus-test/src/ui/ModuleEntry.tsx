/* modules/order-nexus-test/src/ui/ModuleEntry.tsx */

import React from 'react';

const OrderNexusTestHome = () => {
  return <div style={{ padding: 20 }}>OrderNexus Test</div>;
};

const descriptor = {
  id: 'order-nexus-test',
  name: 'OrderNexusTest',
  version: '0.1.0',

  routes: [
    {
      id: 'order-nexus-test-home',
      key: 'order-nexus-test-home',
      name: 'OrderNexusTest Home',
      path: '/order-nexus-test',
      component: OrderNexusTestHome,
      requiredModuleId: 'order-nexus-test',
      order: 100
    }
  ],

  navItems: [
    {
      id: 'order-nexus-test-home',
      title: 'OrderNexusTest',
      path: '/order-nexus-test',
      order: 50
    }
  ]
};

export default descriptor;

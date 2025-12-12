import React from 'react';

const OrdersPage = () => <div style={{padding:20}}>OrderNexus (placeholder)</div>;

const descriptor = {
  id: 'order-nexus',
  name: 'OrderNexus',
  version: '0.1.0',
  routes: [
    { id: 'orders', key: 'orders', name: 'Orders', path: '/orders', component: OrdersPage, requiredModuleId: 'order-nexus', order: 100 }
  ],
  navItems: [
    { id: 'orders', title: 'Orders', path: '/orders', order: 50 }
  ]
};

// Descriptor already contains `id` — export it directly to avoid duplicate-id
// object-literals (and satisfy the checker).
export default descriptor;

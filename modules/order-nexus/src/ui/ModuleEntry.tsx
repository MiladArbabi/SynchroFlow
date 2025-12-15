// modules/order-nexus/src/ui/ModuleEntry.tsx
import OrdersPage from './pages/OrdersPage';

const descriptor = {
  id: 'order-nexus',
  name: 'OrderNexus',
  version: '0.1.0',

  navGroups: [
    {
      id: 'operations',
      label: 'Operations',
      order: 20
    }
  ],

  navItems: [
    {
      id: 'orders',
      title: 'Orders',
      path: '/orders',
      group: 'operations',
      order: 10,
      requiredModuleId: 'order-nexus'
    }
  ],

  routes: [
    {
      id: 'orders',
      path: '/orders',
      component: OrdersPage,
      requiredModuleId: 'order-nexus',
      order: 100
    }
  ]
};

export default descriptor;
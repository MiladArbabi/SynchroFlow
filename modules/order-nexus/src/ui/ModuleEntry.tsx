import { ShoppingCart } from 'lucide-react';

export default {
  id: 'order-nexus',
  name: 'OrderNexus',
  version: '0.1.0',

  navGroups: [
    { id: 'operations', label: 'Operations', order: 20 }
  ],

  navItems: [
    {
      id: 'orders',
      title: 'Orders',
      path: '/orders',
      group: 'operations',
      order: 10,
      icon: ShoppingCart,
      requiredModuleId: 'order-nexus'
    }
  ]
};
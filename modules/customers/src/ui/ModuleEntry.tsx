// modules/customers/src/ui/ModuleEntry.tsx
import { UsersRound } from 'lucide-react';

const descriptor = {
  id: 'customers',
  name: 'Customers',
  version: '0.1.0',

  navItems: [
    {
      id: 'customers',
      title: 'Customers',
      path: '/customers',
      group: 'operations',
      order: 30,
      icon: UsersRound,
      requiredModuleId: 'customers'
    }
  ]
};

export default descriptor;

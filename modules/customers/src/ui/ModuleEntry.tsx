// modules/customers/src/ui/ModuleEntry.tsx
import CustomersPage from './pages/CustomersPage';
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
      order: 20,
      icon: UsersRound,
      requiredModuleId: 'customers'
    }
  ],

  routes: [
    {
      id: 'customers',
      path: '/customers',
      component: CustomersPage,
      /* requiredModuleId: 'customers', */ //Ensure to Re-add later
      order: 110
    }
  ]
};

export default descriptor;
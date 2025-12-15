// modules/customers/src/ui/ModuleEntry.tsx
import CustomersPage from './pages/CustomersPage';

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
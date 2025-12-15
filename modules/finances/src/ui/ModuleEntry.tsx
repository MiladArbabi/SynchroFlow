// modules/finances/src/ui/ModuleEntry.tsx
import FinancesPage from './pages/FinancesPage';
import { DollarSign } from 'lucide-react';

const descriptor = {
  id: 'finances',
  name: 'Finances',
  version: '0.1.0',

  navItems: [
    {
      id: 'finances',
      title: 'Finances',
      path: '/finances',
      group: 'analytics',
      icon: DollarSign,
      order: 20,
      requiredModuleId: 'finances'
    }
  ],

  routes: [
    {
      id: 'finances',
      path: '/finances',
      component: FinancesPage,
      requiredModuleId: 'finances',
      order: 100
    }
  ]
};

export default descriptor;
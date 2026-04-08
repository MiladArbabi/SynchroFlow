// modules/cashflow/src/ui/ModuleEntry.tsx
import { TrendingUp } from 'lucide-react';

export default {
  id: 'cashflow',
  name: 'Cash Flow',
  version: '0.1.0',
  navGroups: [
    { id: 'finances', label: 'Finances', order: 30 }
  ],
  navItems: [
    {
      id: 'cashflow',
      title: 'Cash Flow',
      path: '/cashflow',
      group: 'finances',
      order: 10,
      icon: TrendingUp,
      requiredModuleId: 'cashflow'
    }
  ]
};
// modules/analytics/src/ui/ModuleEntry.tsx
import { BarChart } from 'lucide-react';

const descriptor = {
  id: 'analytics',
  name: 'Analytics',
  version: '0.1.0',

  navItems: [
    {
      id: 'analytics',
      title: 'Analytics',
      path: '/analytics',
      group: 'analytics',
      icon: BarChart,
      order: 10,
      requiredModuleId: 'analytics'
    }
  ],
};

export default descriptor;

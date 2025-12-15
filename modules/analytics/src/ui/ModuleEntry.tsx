// modules/analytics/src/ui/ModuleEntry.tsx
import AnalyticsPage from './pages/AnalyticsPage';
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

  routes: [
    {
      id: 'analytics',
      path: '/analytics',
      component: AnalyticsPage,
      requiredModuleId: 'analytics',
      order: 100
    }
  ]
};

export default descriptor;

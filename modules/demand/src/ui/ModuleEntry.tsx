import { BarChart2 } from 'lucide-react';

export default {
  id: 'demand',
  name: 'Demand',
  version: '0.1.0',
  navGroups: [{ id: 'operations', label: 'Operations', order: 20 }],
  navItems: [{
    id: 'demand',
    title: 'Demand',
    path: '/demand',
    group: 'operations',
    order: 20,
    icon: BarChart2,
    requiredModuleId: 'demand'
  }]
};
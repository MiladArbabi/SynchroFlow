// modules/returns/src/ui/ModuleEntry.tsx
import { RotateCcw } from 'lucide-react';

export default {
  id: 'returns',
  name: 'Returns',
  version: '0.1.0',
  navGroups: [
    { id: 'operations', label: 'Operations', order: 20 }
  ],
  navItems: [
    {
      id: 'returns',
      title: 'Returns',
      path: '/returns',
      group: 'operations',
      order: 15,
      icon: RotateCcw,
      requiredModuleId: 'returns'
    }
  ]
};
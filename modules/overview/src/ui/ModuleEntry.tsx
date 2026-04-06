// modules/overview/src/ui/ModuleEntry.tsx
import { IconShieldCheck } from '@tabler/icons-react';
import type { ModuleDescriptor } from './ModuleDescriptor.js';

const descriptor: ModuleDescriptor = {
  id: 'overview',
  name: 'Overview',
  version: '0.1.0',

  routes: [
    {
      id: 'overview-ft2',
      path: '/overview',
      requiredModuleId: 'overview',
      order: 10,
    },
  ],

  navItems: [
    {
      id: 'overview',
      title: 'Overview',
      path: '/overview',
      group: 'operations',
      order: 10,
      icon: IconShieldCheck, 
      requiredModuleId: 'overview',
    },
  ],
};

export default descriptor;

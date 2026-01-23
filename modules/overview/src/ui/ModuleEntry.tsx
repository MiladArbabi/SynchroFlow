// modules/overview/src/ui/ModuleEntry.tsx

import type { ModuleDescriptor } from './ModuleDescriptor';

const descriptor: ModuleDescriptor = {
  id: 'overview',
  name: 'Overview',
  version: '0.1.0',

  routes: [
    {
      id: 'overview-ft2',
      path: '/overview',
      requiredModuleId: 'overview',
      order: 20,
    },
  ],

  navItems: [
    {
      id: 'overview',
      title: 'Overview',
      path: '/overview',
      group: 'operations',
      order: 20,
      requiredModuleId: 'overview',
    },
  ],
};

export default descriptor;

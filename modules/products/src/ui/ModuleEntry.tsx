// modules/products/src/ui/ModuleEntry.tsx
import { Package } from 'lucide-react';

const descriptor = {
  id: 'products',
  name: 'Products',
  version: '0.1.0',

  navItems: [
    {
      id: 'products',
      title: 'Products',
      path: '/products',
      group: 'operations',
      order: 30,
      icon: Package,
      requiredModuleId: 'products'
    }
  ],
};

export default descriptor;

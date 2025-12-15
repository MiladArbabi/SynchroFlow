// modules/products/src/ui/ModuleEntry.tsx
import ProductsPage from './pages/ProductsPage';
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

  routes: [
    {
      id: 'products',
      path: '/products',
      component: ProductsPage,
      /* requiredModuleId: 'products', */
      order: 120                // after Orders (100) & Customers (110)
    }
  ]
};

export default descriptor;

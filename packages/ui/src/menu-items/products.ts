// packages/ui/src/menu-items/products.ts
import { Package } from 'lucide-react';
import { NavItemType } from './types';

const products: NavItemType = {
  id: 'products',
  title: 'Products',
  type: 'item',
  url: '/products',
  icon: Package,
  breadcrumbs: false
};

export default products;
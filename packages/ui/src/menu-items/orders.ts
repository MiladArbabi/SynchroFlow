// packages/ui/src/menu-items/orders.ts
import { ShoppingCart } from 'lucide-react';
import { NavItemType } from './types';

const orders: NavItemType = {
  id: 'orders',
  title: 'Orders',
  type: 'item',
  url: '/orders',
  icon: ShoppingCart,
  breadcrumbs: false
};

export default orders;
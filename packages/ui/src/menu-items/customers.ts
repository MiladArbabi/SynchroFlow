// packages/ui/src/menu-items/customers.ts
import { Users } from 'lucide-react';
import { NavItemType } from './types';

const customers: NavItemType = {
  id: 'customers',
  title: 'Customers',
  type: 'item',
  url: '/customers',
  icon: Users,
  breadcrumbs: false
};

export default customers;
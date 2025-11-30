// apps/frontend/src/menu-items/index.ts
import { MenuItems, NavItemType } from './types';
import { MessageSquare } from 'lucide-react';

// Import Items
import dashboard from './dashboard';
import orders from './orders';
import customers from './customers';
import products from './products';
import analytics from './analytics';
import finances from './finances';

// ==============================|| MENU ITEMS ||============================== //

const echoHub: NavItemType = {
  id: 'echo-hub',
  title: 'Echo Inbox',
  type: 'item',
  url: '/echo-hub',
  icon: MessageSquare,
  breadcrumbs: false
};

// CORRECTED STRUCTURE: Must conform to MenuItems interface
const menuItems: MenuItems = {
  items: [
    {
      id: 'dashboard-group',
      type: 'group',
      children: [
        dashboard
      ]
    },
    {
      id: 'entities-group',
      title: 'Entities', // Optional group title
      type: 'group',
      children: [
        orders,
        customers,
        products,
      ]
    },
      {
     id: 'intelligence-group',
     title: 'Intelligence',
     type: 'group',
     children: [
       analytics,
       finances,
     ]
   },
    {
      id: 'communication-group',
      type: 'group',
      children: [echoHub]
    }
    // Old, removed items (dataMapper, productIntelligence) are gone.
  ]
};

export default menuItems;
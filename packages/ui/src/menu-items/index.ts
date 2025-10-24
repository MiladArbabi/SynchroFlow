// packages/ui/src/menu-items/index.ts
import { MenuItems } from './types';

// Import Items
import dashboard from './dashboard';
import orders from './orders';
import customers from './customers';
import products from './products';

// ==============================|| MENU ITEMS ||============================== //

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
    }
    // Old, removed items (dataMapper, productIntelligence) are gone.
  ]
};

export default menuItems;
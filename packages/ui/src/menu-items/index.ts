// packages/ui/src/menu-items/index.ts
import dashboard from './dashboard';
import products from './products';
import dataMapper from './dataMapper';
import productIntelligence from './productIntelligence';
import { MenuItems, NavGroupType } from './types';

// ==============================|| MENU ITEMS ||============================== //

// Structure items potentially under groups later if needed
const menuItems: MenuItems = {
items: [
    {
      id: 'group-main-nav', // Give the group an ID
      // title: 'Navigation', // Optional: Add a title if you want a subheader above the items
      type: 'group', // Set the type to 'group'
      // Define the children of this group
      children: [
        dashboard,
        products,
        dataMapper,
        productIntelligence
      ]
    } as NavGroupType
  ]
 };

export default menuItems;
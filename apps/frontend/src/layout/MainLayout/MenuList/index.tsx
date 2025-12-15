//apps/frontend/src/layout/MainLayout/MenuList/index.tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useMemo, useState } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

// project imports
import NavItem from './NavItem';
import NavGroup from './NavGroup';
import { MenuOrientation } from 'config';
import menuItems from 'menu-items'; // Imports { items: NavGroupType[] }
import { MenuItem, NavGroupType, NavItemType } from 'menu-items/types';
import useConfig from 'hooks/useConfig';
import { useTheme } from '@mui/material/styles';

// import { Menu } from 'menu-items/widget';
import { HORIZONTAL_MAX_ITEM } from 'config';
import { useGetMenuMaster } from 'api/menu';

import { getNavigation } from "runtime/registerNav";

// ==============================|| SIDEBAR MENU LIST ||============================== //

function MenuList({ allowedRoutes }: { allowedRoutes?: string[] }) {
  const theme = useTheme(); // Get theme instance
  const downMD = useMediaQuery(theme.breakpoints.down('md'));

  const {
    state: { menuOrientation }
  } = useConfig();
  const { menuMaster } = useGetMenuMaster();
  const drawerOpen = menuMaster.isDashboardDrawerOpened;
  const isHorizontal = menuOrientation === MenuOrientation.HORIZONTAL && !downMD;

  const [selectedID, setSelectedID] = useState('');

  const visibleItems: NavGroupType[] = useMemo(() => {
    
  const dynamicGroupsRaw = getNavigation();

   // 2. Adapt runtime NavGroup → UI NavGroupType
    const dynamicItems: NavItemType[] = dynamicGroupsRaw.flatMap((g) =>
    (g.items ?? []).map((item) => {
      // Runtime nav items are guaranteed to be NavItem-like
      return {
        id: item.id,
        title: item.title ?? item.id, // safe fallback
        type: 'item',
        url: item.path,
        icon: item.icon,
        breadcrumbs: false
      };
    })
  );
  
   // 3. Merge static menu groups + dynamic module nav groups
   const base: NavGroupType[] = [
    ...menuItems.items,
    {
      id: 'dynamic-modules',
      title: 'Modules',
      type: 'group',
      children: dynamicItems
    }
  ];

    if (!allowedRoutes || allowedRoutes.length === 0) {
      // No gating info → show everything
      return base;
    }

    const routeSet = new Set(allowedRoutes);

    return base
      .map((group) => {
        const children = group.children?.filter((child: NavItemType) => {
          const url = (child as NavItemType).url;
          if (!url) return true; // labels / non-click items

          // ⚡ Cross-sell rule:
          // Always show Analytics & Finances in the sidenav,
          // even if the route is not currently "allowed" by entitlements.
          if (url === '/analytics' || url === '/finances') {
            return true;
          }

          // Static routes are gated via routes.tsx
          if (routeSet.has(url)) return true;

          // Dynamic module routes (e.g. /orders) are trusted
          return Boolean(url);
        }) as NavItemType[] | undefined;

        return { ...group, children };
      })
      // Drop groups that end up with no visible children
      .filter((group) => !group.children || group.children.length > 0);
  }, [allowedRoutes]);

  // last menu-item to show in horizontal menu bar
  const lastItem = isHorizontal ? HORIZONTAL_MAX_ITEM : null;

  let lastItemIndex = visibleItems.length - 1;
  let remItems: any[] = [];
  let lastItemId;

  if (lastItem && lastItem < visibleItems.length) {
    lastItemId = visibleItems[lastItem - 1].id;
    lastItemIndex = lastItem - 1;
    remItems = visibleItems.slice(lastItem - 1, visibleItems.length).map((item) => ({
      // Safely access properties based on item type if structure varies
      title: 'title' in item ? item.title : undefined, // Check if title exists
      elements: 'children' in item ? item.children : undefined, // Check for children
      icon: 'icon' in item ? item.icon : undefined, // Check for icon
      ...( 'url' in item && item.url && { // Check for url
        url: item.url,
        // If it's a NavItemType, include necessary properties for NavItem component
        id: item.id,
        type: item.type,
        target: item.target,
        disabled: 'disabled' in item ? item.disabled : undefined,
      })
    }));
  }

  const navItems = visibleItems.slice(0, lastItemIndex + 1).map((item: NavGroupType, index) => {
    switch (item.type) {
      case 'group':
        return (
          <NavGroup
            key={item.id}
            setSelectedID={setSelectedID}
            selectedID={selectedID}
            item={item}
            lastItem={lastItem}
            remItems={remItems}
            lastItemId={lastItemId}
          />
        );
        // --- FIX: Handle 'item' type if it *could* appear at the top level (unlikely now) ---
        /* else if (item.type === 'item') {
             // This case shouldn't happen with our current menuItems structure
             return (
               <List key={item.id}>
                  <NavItem item={item as NavItemType} level={1} isParents setSelectedID={() => setSelectedID('')} />
                  {!isHorizontal && index !== 0 && <Divider sx={{ py: 0.5 }} />}
               </List>
             );
        }*/
      default:
        return (
          <Typography key={item.id} variant="h6" align="center" sx={{ color: 'error.main' }}>
            Menu Items Error
          </Typography>
        );
    }
  });

  return <Box>{navItems}</Box>;
}

export default memo(MenuList);
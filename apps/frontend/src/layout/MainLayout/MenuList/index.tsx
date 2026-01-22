// ⚠️ LEGACY — DO NOT USE
// This file contains pre-v1.0 entitlement logic.
// Replaced by static nav rebuild + sealed entitlement contract.

// apps/frontend/src/layout/MainLayout/MenuList/index.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useMemo, useState } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

import NavGroup from './NavGroup';
import { MenuOrientation } from 'config';
import menuItems from 'menu-items';
import { NavGroupType, NavItemType } from 'menu-items/types';
import useConfig from 'hooks/useConfig';
import { useTheme } from '@mui/material/styles';

import { HORIZONTAL_MAX_ITEM } from 'config';

import { getNavigation } from 'runtime/registerNav';
import { resolveNavVisibility } from 'navigation/resolveNavVisibility';
import { useEntitlements } from 'contexts/EntitlementsContext';

// Host-level override: modules that are always enabled during Phase 0
const CORE_MODULES = new Set<string>([
  'order-nexus',
  'customers',
  'products',
  'finances'
]);

// ==============================|| SIDEBAR MENU LIST ||============================== //

function MenuList({ allowedRoutes }: { allowedRoutes?: string[] }) {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
  const { modules } = useEntitlements();

  const {
    state: { menuOrientation }
  } = useConfig();

  const isHorizontal = menuOrientation === MenuOrientation.HORIZONTAL && !downMD;
  const [selectedID, setSelectedID] = useState('');

  const visibleItems: NavGroupType[] = useMemo(() => {
    // 1️⃣ Dynamic module nav
    const dynamicGroupsRaw = getNavigation();
    /* console.log('[NAV_DEBUG][groups]', dynamicGroupsRaw); */

    const dynamicItems: NavItemType[] = dynamicGroupsRaw
      .flatMap((g) => g.items ?? [])
      .map((item) => {
            /* console.log('[NAV_DEBUG]', {
              item: item.id,
              requiredModuleId: item.requiredModuleId,
              entitlementsModules: modules
            }); */
        const visibility = !item.requiredModuleId
          ? 'enabled'
          : CORE_MODULES.has(item.requiredModuleId)
          ? 'enabled'
          : resolveNavVisibility({
              requiredModuleId: item.requiredModuleId,
              modules
            });


        if (visibility === 'hidden') return null;

        return {
          id: item.id,
          title: item.title ?? item.id,
          type: 'item',
          url: item.path,
          icon: item.icon,
          disabled: visibility === 'locked',
          meta: { visibility },
          breadcrumbs: false
        };
      })
      .filter(Boolean) as NavItemType[];

    // 2️⃣ Merge static + dynamic
    const base: NavGroupType[] = [
      ...menuItems.items,
      {
        id: 'dynamic-modules',
        title: 'Modules',
        type: 'group',
        children: dynamicItems
      }
    ];

    // 3️⃣ No route gating → return everything
    if (!allowedRoutes || allowedRoutes.length === 0) {
      return base;
    }

    const routeSet = new Set(allowedRoutes);

    // 4️⃣ Route-based visibility filtering
    return base
      .map((group) => {
        const children = group.children?.filter((child: NavItemType) => {
          if (!child.url) return true;
          return routeSet.has(child.url);
        });

        return { ...group, children };
      })
      .filter((group) => !group.children || group.children.length > 0);
  }, [allowedRoutes, modules]);

  // ─────────────────────────────────────────────

  const lastItem = isHorizontal ? HORIZONTAL_MAX_ITEM : null;

  let lastItemIndex = visibleItems.length - 1;
  let remItems: any[] = [];
  let lastItemId;

  if (lastItem && lastItem < visibleItems.length) {
    lastItemId = visibleItems[lastItem - 1].id;
    lastItemIndex = lastItem - 1;
    remItems = visibleItems.slice(lastItem - 1).map((item) => ({
      title: 'title' in item ? item.title : undefined,
      elements: 'children' in item ? item.children : undefined,
      icon: 'icon' in item ? item.icon : undefined
    }));
  }

  const navItems = visibleItems.slice(0, lastItemIndex + 1).map((item) => {
    if (item.type === 'group') {
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
    }

    return (
      <Typography
        key={item.id}
        variant="h6"
        align="center"
        sx={{ color: 'error.main' }}
      >
        Menu Items Error
      </Typography>
    );
  });

  return <Box>{navItems}</Box>;
}

export default memo(MenuList);
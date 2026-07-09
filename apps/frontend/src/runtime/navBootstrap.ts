/* apps/frontend/src/runtime/navBootstrap.ts
 *
 * PLATFORM NAVIGATION BOOTSTRAP
 * --------------------------------
 * Single "WORKSPACE" group — 8 top-level items, children define submodules.
 *
 * RULES:
 * - One group: 'workspace'. No sub-groups ever.
 * - Max 8 top-level items. Product sign-off required to add more.
 * - Children array → compact mode renders hover popover to the right.
 *                  → expanded mode renders inline accordion below parent.
 * - Parents with no children navigate directly on click in both modes.
 * - Icons: lucide-react only, monochrome.
 * - Tier gating: requiredTier shows upgrade badge, never hides the item.
 * - Never add business logic here — nav structure only.
 */
import {
  LayoutDashboard,
  ShoppingBag,
  Warehouse,
  RotateCcw,
  Box,
  Truck,
  /* DollarSign, */
} from 'lucide-react';
import { registerNavGroup, registerNavItem } from './registerNav';

export function bootstrapNavGroups() {

  // ── SINGLE GROUP ──────────────────────────────────────────────────────────
  registerNavGroup({ id: 'workspace', label: 'Workspace', order: 10 });

  // ── ITEMS — ordered by daily-use frequency ────────────────────────────────
  // Do not reorder without product sign-off.

  registerNavItem({
    id: 'overview',
    title: 'Overview',
    path: '/overview',
    group: 'workspace',
    order: 10,
    icon: LayoutDashboard,
    requiredModuleId: 'overview',
    // No children — navigates directly in both compact and expanded modes.
  });

  registerNavItem({
    id: 'orders',
    title: 'Orders',
    path: '/orders',
    group: 'workspace',
    order: 20,
    icon: ShoppingBag,
    requiredModuleId: 'order-nexus',
    children: [
      { id: 'orders-overview', title: 'Overview',   path: '/orders'   },
      { id: 'order-flow',      title: 'Order Flow', path: '/orders/flow'   },
      { id: 'outbound',        title: 'Outbound',   path: '/orders/outbound' },
    ],
  });

    registerNavItem({
    id: 'inventory',
    title: 'Inventory',
    path: '/inventory',
    group: 'workspace',
    order: 30,
    icon: Box,
    requiredModuleId: 'products',
    children: [
      { id: 'products-intelligence',  title: 'Intelligence',   path: '/inventory'                },
      { id: 'products-catalog',       title: 'Catalog',        path: '/inventory/catalog'        },
      // parentId set explicitly: path (/demand) is not URL-nested under /inventory — see ISS-095/DEC-04
      { id: 'demand',                 title: 'Demand',         path: '/demand',  requiredTier: 'growth', parentId: 'inventory' },
      { id: 'products-costs',         title: 'Costs',          path: '/inventory/costs'          },
      { id: 'data-quality',           title: 'Data Quality',   path: '/inventory/data-quality'  },    
    ],
  });

  registerNavItem({
    id: 'warehouse',
    title: 'Warehouse',
    path: '/wms',
    group: 'workspace',
    order: 40,
    icon: Warehouse,
    requiredModuleId: 'wms-lite',
    children: [
      { id: 'wms-operations',  title: 'Operations',     path: '/wms'      },
      { id: 'floor-planning',  title: 'Floor Planning', path: '/floor-planning',  requiredTier: 'scale', parentId: 'warehouse' },
      { id: 'wms-analytics',   title: 'Analytics',      path: '/wms/analytics'   },
      // DEC-01/DEC-03: relocated from returns-resolution — Problem Center is a warehouse-floor exception queue (pick/pack/stow/receive), not a customer-returns screen. parentId set explicitly since path (/problem-center) is not URL-nested under /wms.
      { id: 'product-issues', title: 'Problem Center', path: '/problem-center', parentId: 'warehouse' },
    ],
  });

  registerNavItem({
    id: 'returns-resolution',
    title: 'Returns',
    path: '/returns',
    group: 'workspace',
    order: 50,
    icon: RotateCcw,
    requiredTier: 'core',
    // No requiredModuleId: children enforce independently server-side
    // under different module gates (returns:*, wms:read). See #38/#39.
    children: [
      // product-issues moved to warehouse.children[] — DEC-01/DEC-03 (2026-07-08)
      { id: 'returns',   title: 'Overview',   path: '/returns'        },
      { id: 'return-items',   title: 'Items',   path: '/returns/items'        },
      { id: 'supplier-ratings',   title: 'Supplier Ratings',   path: '/returns/suppliers'        },
    ],
  });

  registerNavItem({
    id: 'purchasing',
    title: 'Purchasing',
    path: '/suppliers-portal',
    group: 'workspace',
    order: 60,
    icon: Truck,
    requiredModuleId: 'suppliers-portal',
    children: [
      { id: 'open-pos',               title: 'Open POs',   path: '/suppliers-portal'                },
      { id: 'suppliers',              title: 'Suppliers',        path: '/suppliers-portal/suppliers'},
      { id: 'sourcing',               title: 'Sourcing',         path: '/suppliers-portal/sourcing'  },
    ],
  });

  /* registerNavItem({
    id: 'finances',
    title: 'Finances',
    path: '/finances',
    group: 'workspace',
    order: 70,
    icon: DollarSign,
    requiredModuleId: 'cashflow',
    requiredTier: 'growth',
    children: [
      { id: 'finances-main',   title: 'Finances',  path: '/finances'        },
      { id: 'cashflow',        title: 'Cash Flow', path: '/cashflow'        },
      { id: 'finances-margin', title: 'Margin',    path: '/finances/margin' },
    ],
  }); */
}
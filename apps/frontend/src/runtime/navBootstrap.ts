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
  TrendingUp,
  Box,
  Truck,
  DollarSign,
  Users,
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
      { id: 'orders-overview', title: 'Overview',   path: '/orders'          },
      { id: 'order-flow',      title: 'Order Flow', path: '/orders/flow'     },
      { id: 'outbound',        title: 'Outbound',   path: '/orders/outbound' },
      { id: 'inbound',         title: 'Inbound',    path: '/orders/inbound'  },
      { id: 'returns',         title: 'Returns',    path: '/returns'         },
    ],
  });

  registerNavItem({
    id: 'warehouse',
    title: 'Warehouse',
    path: '/wms',
    group: 'workspace',
    order: 30,
    icon: Warehouse,
    requiredModuleId: 'wms-lite',
    children: [
      { id: 'wms-operations',  title: 'Operations',     path: '/wms'             },
      { id: 'floor-planning',  title: 'Floor Planning', path: '/floor-planning',  requiredTier: 'scale' },
      { id: 'wms-analytics',   title: 'Analytics',      path: '/wms/analytics'   },
    ],
  });

  registerNavItem({
    id: 'demand',
    title: 'Demand',
    path: '/demand',
    group: 'workspace',
    order: 40,
    icon: TrendingUp,
    requiredModuleId: 'demand',
    requiredTier: 'growth',
    // No children — navigates directly.
  });

  registerNavItem({
    id: 'inventory',
    title: 'Inventory',
    path: '/inventory',
    group: 'workspace',
    order: 50,
    icon: Box,
    requiredModuleId: 'products',
    children: [
      { id: 'products-intelligence',  title: 'Intelligence',   path: '/inventory'                },
      { id: 'products-catalog',       title: 'Catalog',        path: '/inventory/catalog'        },
      { id: 'products-costs',         title: 'Costs',          path: '/inventory/costs'          },
      { id: 'products-wms-readiness', title: 'WMS Readiness',  path: '/wms/readiness'  },
      { id: 'problem-center',         title: 'Problem Center', path: '/problem-center'          },
    ],
  });

  registerNavItem({
    id: 'suppliers',
    title: 'Suppliers',
    path: '/suppliers-portal',
    group: 'workspace',
    order: 60,
    icon: Truck,
    requiredModuleId: 'suppliers-portal',
    // No children — navigates directly.
  });

  registerNavItem({
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
  });

  registerNavItem({
    id: 'team',
    title: 'Team',
    path: '/team',
    group: 'workspace',
    order: 80,
    icon: Users,
    // No requiredModuleId — team management is platform-level, not module-gated.
    // Settings accessed via profile avatar popper, not sidenav.
  });
}
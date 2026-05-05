/* apps/frontend/src/runtime/navBootstrap.ts
 *
 * PLATFORM NAVIGATION BOOTSTRAP
 * --------------------------------
 * Defines the authoritative sidenav structure for LaSyncro.
 *
 * OPERATOR MENTAL MODEL (not module names):
 *   DAILY OPS   — what you do every day (free + core)
 *   INTELLIGENCE — what makes you smarter (growth gate)
 *   CATALOG     — what you sell and who supplies it (core)
 *   SYSTEM      — alerts, problems, settings
 *
 * RULES:
 * - Groups are platform-owned — modules register items into them
 * - Order is platform-controlled via order field
 * - requiredTier drives upgrade badge in SidenavContent
 * - Icons: lucide-react only, monochrome (color via theme, not icon)
 * - Never add business logic here — only nav structure
 */
import {
  LayoutDashboard,
  ShoppingBag,
  Warehouse,
  TrendingUp,
  BarChart2,
  DollarSign,
  Users,
  RotateCcw,
  Package,
  Truck,
  AlertTriangle,
  Map,
} from 'lucide-react';
import { registerNavGroup, registerNavItem } from './registerNav';

export function bootstrapNavGroups() {

  // ── GROUPS ────────────────────────────────────────────────────
  registerNavGroup({ id: 'daily',        label: 'Daily Ops',     order: 10 });
  registerNavGroup({ id: 'intelligence', label: 'Intelligence',  order: 20 });
  registerNavGroup({ id: 'catalog',      label: 'Catalog',       order: 30 });
  registerNavGroup({ id: 'system',       label: 'System',        order: 40 });

  // ── DAILY OPS ─────────────────────────────────────────────────
  // Free tier and above — core operational surfaces
  registerNavItem({
    id: 'overview',
    title: 'Overview',
    path: '/overview',
    group: 'daily',
    order: 10,
    icon: LayoutDashboard,
    requiredModuleId: 'overview',
  });

  registerNavItem({
    id: 'orders',
    title: 'Orders',
    path: '/orders',
    group: 'daily',
    order: 20,
    icon: ShoppingBag,
    requiredModuleId: 'order-nexus',
  });

  registerNavItem({
    id: 'wms',
    title: 'Warehouse',
    path: '/wms',
    group: 'daily',
    order: 40,
    icon: Warehouse,
    requiredModuleId: 'wms-lite',
  });

  // ── INTELLIGENCE ──────────────────────────────────────────────
  // Growth tier gate — visible but locked for starter/core
  // Teased in sidenav with upgrade badge to drive conversion
  registerNavItem({
    id: 'cashflow',
    title: 'Cash Flow',
    path: '/cashflow',
    group: 'intelligence',
    order: 10,
    icon: TrendingUp,
    requiredModuleId: 'cashflow',
    requiredTier: 'growth',
  });

  registerNavItem({
    id: 'demand',
    title: 'Demand',
    path: '/demand',
    group: 'intelligence',
    order: 20,
    icon: BarChart2,
    requiredModuleId: 'demand',
    requiredTier: 'growth',
  });

  registerNavItem({
    id: 'finances',
    title: 'Finances',
    path: '/finances',
    group: 'intelligence',
    order: 30,
    icon: DollarSign,
    requiredModuleId: 'finances',
    requiredTier: 'growth',
  });

  registerNavItem({
    id: 'customers',
    title: 'Customers',
    path: '/customers',
    group: 'intelligence',
    order: 40,
    icon: Users,
    requiredModuleId: 'customers',
    requiredTier: 'growth',
  });

  registerNavItem({
    id: 'returns',
    title: 'Returns',
    path: '/returns',
    group: 'intelligence',
    order: 50,
    icon: RotateCcw,
    requiredModuleId: 'returns',
  });

  // ── CATALOG ───────────────────────────────────────────────────
  registerNavItem({
    id: 'products',
    title: 'Products',
    path: '/products',
    group: 'catalog',
    order: 10,
    icon: Package,
    requiredModuleId: 'products',
  });

  registerNavItem({
    id: 'suppliers-portal',
    title: 'Suppliers',
    path: '/suppliers-portal',
    group: 'catalog',
    order: 20,
    icon: Truck,
    requiredModuleId: 'suppliers-portal',
  });

  registerNavItem({
    id: 'floor-planning',
    title: 'Floor Planning',
    path: '/floor-planning',
    group: 'catalog',
    order: 30,
    icon: Map,
    requiredModuleId: 'floor-planning',
    requiredTier: 'scale',
  });

  // ── SYSTEM ────────────────────────────────────────────────────
  registerNavItem({
    id: 'problem-center',
    title: 'Problem Center',
    path: '/problem-center',
    group: 'system',
    order: 20,
    icon: AlertTriangle,
    requiredModuleId: 'problem-center',
  });
}
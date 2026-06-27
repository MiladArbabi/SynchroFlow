// apps/frontend/src/pages/ft2-pages/ordersModuleTabs.ts
//
// ORDERS MODULE TAB DEFINITION
// ----------------------------
// Shared tab bar for the Orders module.
//
// Visible operational model:
// - Overview: executive pulse
// - Order Flow: blocked orders, release pool, and fulfillment status
// - Outbound: shipped/fulfilled ledger
// - Inbound: incoming order/warehouse context
// - Returns: returns surface
//
// Legacy compatibility routes still exist:
// - /orders/blocked
// - /orders/pool
// - /fulfillment
//
// Those legacy routes should not stay visible as primary tabs after Order Flow
// becomes the working surface.

import type { ModuleTab } from '../../components/ModuleTabBar';

export const ORDERS_MODULE_TABS: ModuleTab[] = [
  { id: 'overview',   label: 'Overview',   path: '/orders'          },
  { id: 'flow',       label: 'Order Flow', path: '/orders/flow'     },
  { id: 'outbound',   label: 'Outbound',   path: '/orders/outbound' },
];
// apps/frontend/src/pages/ft2-pages/ordersModuleTabs.ts
//
// ORDERS MODULE TAB DEFINITION — shared across all 5 Orders routes.
// Import this into: OrdersFT2Page, FulfillmentQueuePage, ReturnsFT2Page,
// OrdersOutboundPage, OrdersInboundPage.
// Changing tab order or routes here propagates everywhere automatically.

import type { ModuleTab } from '../../components/ModuleTabBar';

export const ORDERS_MODULE_TABS: ModuleTab[] = [
  { id: 'overview',     label: 'Overview',     path: '/orders'          },
  { id: 'fulfillment',  label: 'Fulfillment',  path: '/fulfillment'     },
  { id: 'outbound',     label: 'Outbound',     path: '/orders/outbound' },
  { id: 'inbound',      label: 'Inbound',      path: '/orders/inbound'  },
  { id: 'returns',      label: 'Returns',      path: '/returns'         },
];
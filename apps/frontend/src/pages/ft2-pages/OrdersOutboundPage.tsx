// apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx
//
// OUTBOUND TAB — placeholder
// Route: /orders/outbound
// Part of the 5-tab Orders module surface.
// Full build: shipped orders + tracking (see handover ORD-06).

import { Box, Typography } from '@mui/material';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';

export default function OrdersOutboundPage() {
  return (
    <Box>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <Box sx={{ p: 4 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Outbound</Typography>
        <Typography variant="body2" color="text.secondary">
          Shipped orders and tracking — coming soon.
        </Typography>
      </Box>
    </Box>
  );
}
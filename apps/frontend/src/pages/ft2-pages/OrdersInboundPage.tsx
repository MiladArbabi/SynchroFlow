// apps/frontend/src/pages/ft2-pages/OrdersInboundPage.tsx
//
// INBOUND TAB — placeholder
// Route: /orders/inbound
// Part of the 5-tab Orders module surface.
// Full build: WMS receiving surface (see handover ORD-06).

import { Box, Typography } from '@mui/material';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';

export default function OrdersInboundPage() {
  return (
    <Box>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <Box sx={{ p: 4 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Inbound</Typography>
        <Typography variant="body2" color="text.secondary">
          WMS receiving surface — coming soon.
        </Typography>
      </Box>
    </Box>
  );
}
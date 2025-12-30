// apps/frontend/src/ui/ft1-checklist/Ft1ChecklistSurface.tsx
import React, { useEffect, useState } from 'react';
import { Box, Drawer } from '@mui/material';

import { Ft1ChecklistDataSurface } from 'lifecycle/Ft1ChecklistDataSurface';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';

export function Ft1ChecklistSurface() {
  const [open, setOpen] = useState(false);

  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;

  const enabled = phase === 'FT1_READY' && !!shopId;

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('ft1-checklist:open', handler);
    return () =>
      window.removeEventListener('ft1-checklist:open', handler);
  }, []);

  if (!enabled) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => setOpen(false)}
    >
      <Box sx={{ width: 360, p: 2 }}>
        <Ft1ChecklistDataSurface shopId={shopId!} />
      </Box>
    </Drawer>
  );
}
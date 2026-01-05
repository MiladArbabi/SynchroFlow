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
  console.log('[FT1][SURFACE][MOUNT]', {
    phase,
    shopId,
    enabled,
    ts: performance.now(),
  });

  const handler = () => {
      console.log('[FT1][EVENT][RECEIVED]', {
        ts: performance.now(),
      });
      setOpen(true);
    };

    window.addEventListener('ft1-checklist:open', handler);

    return () => {
      console.log('[FT1][SURFACE][UNMOUNT]', {
        ts: performance.now(),
      });
      window.removeEventListener('ft1-checklist:open', handler);
    };
  }, []);

  console.log('[FT1][SURFACE][RENDER]', {
    enabled,
    phase,
    shopId,
    open,
    ts: performance.now(),
  });

  if (!enabled) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      ModalProps={{
        keepMounted: true,
      }}
      onClose={() => setOpen(false)}
    >
      <Box sx={{ width: 360, p: 2 }}>
        <Ft1ChecklistDataSurface shopId={shopId!} open={open} />
      </Box>
    </Drawer>
  );
}
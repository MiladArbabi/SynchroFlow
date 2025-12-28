// apps/frontend/src/ui/ft1-checklist/Ft1ChecklistDevSurface.tsx
import React, { useEffect, useState } from 'react';
import { Box, Drawer } from '@mui/material';
import { Ft1ChecklistShell } from 'lifecycle/Ft1ChecklistShell';

export function Ft1ChecklistDevSurface() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('ft1-checklist:open', handler);
    return () =>
      window.removeEventListener('ft1-checklist:open', handler);
  }, []);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => setOpen(false)}
    >
      <Box sx={{ width: 360, p: 2 }}>
        <Ft1ChecklistShell
          checklist={{
            modules: [
              {
                moduleId: 'order-nexus',
                title: 'Order Nexus',
                tasks: [
                  {
                    id: 'connect-store',
                    label: 'Connect store',
                    completed: false,
                  },
                  {
                    id: 'sync-orders',
                    label: 'Sync orders',
                    completed: false,
                  },
                ],
              },
            ],
          }}
        />
      </Box>
    </Drawer>
  );
}
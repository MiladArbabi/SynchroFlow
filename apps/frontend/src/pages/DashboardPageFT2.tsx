//apps/frontend/src/pages/DashboardPageFT2.tsx
import React from 'react';
import { Grid, Paper, Stack, Typography } from '@mui/material';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

export const DashboardPageFT2: React.FC = () => {
  return (
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={600}>
        Insights unlocked
      </Typography>

      <Grid container spacing={3}>
        {[
          'Orders',
          'Finances',
          'Products',
          'Customers',
          'Analytics',
        ].map((name) => (
          <Grid key={name} size={{ xs: 12, md: 6 }}>
            <Paper elevation={0} sx={{ p: 3 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {name}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                <OrdersModuleFT2 />
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
};
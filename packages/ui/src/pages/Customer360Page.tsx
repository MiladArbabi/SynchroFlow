// packages/ui/src/pages/Customer360Page.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import { Box, Grid, Paper, Typography } from '@mui/material';

/**
 * Customer360Page: Displays the unified view for a single customer.
 * Initial version contains placeholders for different sections.
 */
const Customer360Page: React.FC = () => {
  const { id } = useParams<{ id: string }>(); // Get customer ID from URL

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Details for Customer #{id}
      </Typography>

      <Grid container spacing={3}>
        {/* Profile Section (Placeholder) */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Profile</Typography>
            <Typography variant="body2">Customer Profile Placeholder</Typography>
            {/* Future: <CustomerProfileComponent /> */}
          </Paper>
        </Grid>

        {/* Key Metrics Section (Placeholder) */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Key Metrics</Typography>
            <Typography variant="body2">Key Metrics Placeholder</Typography>
            {/* Future: <CustomerMetricsComponent /> */}
          </Paper>
        </Grid>

        {/* Order History Section (Placeholder) */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Order History</Typography>
            <Typography variant="body2">Order History Placeholder</Typography>
            {/* Future: <CustomerOrderHistoryComponent /> */}
          </Paper>
        </Grid>

        {/* Support History Section (Placeholder) */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Support History</Typography>
            <Typography variant="body2">Support History Placeholder</Typography>
            {/* Future: <CustomerSupportHistoryComponent /> */}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Customer360Page;
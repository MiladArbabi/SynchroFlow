// packages/ui/src/pages/Customer360Page.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import { Box, Grid, Paper, Typography } from '@mui/material';
import CustomerProfile from 'components/Customer360/CustomerProfile.tsx';
import CustomerKeyMetrics from 'components/Customer360/CustomerKeyMetrics.tsx';
import CustomerOrderHistory from 'components/Customer360/CustomerOrderHistory.tsx';
import CustomerSupportHistory from 'components/Customer360/CustomerSupportHistory.tsx';

/**
 * Customer360Page: Displays the unified view for a single customer.
 * Initial version contains placeholders for different sections.
 */
const Customer360Page: React.FC = () => {
  const { id } = useParams<{ id: string }>(); // Get customer ID from URL

  // --- MOCK DATA (Move to state/API call later) ---
  const mockCustomer = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '555-1234',
    tags: ['VIP', 'High Return Rate'],
    shippingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
    billingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
    accountCreated: '2024-01-15T10:00:00Z',
    source: 'Shopify',
  };

  const mockMetrics = {
    ltv: 1204.50,
    aov: 110.40,
    totalOrders: 11,
    totalMargin: 550.25,
    lastOrderDate: '2025-10-15T09:30:00Z',
  };

  const mockOrders = [
    { id: '1002', orderDate: '2025-10-20T14:00:00Z', status: 'Shipped', total: 75.50 },
    { id: '1001', orderDate: '2025-09-15T10:30:00Z', status: 'Delivered', total: 50.00 },
  ];

  const mockTickets = [
    { id: 'TKT-501', subject: 'Question about Shipping', date: '2025-10-25T11:00:00Z', status: 'Pending' as const },
    { id: 'TKT-498', subject: 'Return Request - SF-TS-BLK-M', date: '2025-10-22T16:30:00Z', status: 'Resolved' as const },
  ];
  // --- END MOCK DATA ---

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Details for Customer #{id}
      </Typography>

      <Grid container spacing={3}>
        {/* Profile Section  */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            {/* CustomerProfile component */}
            <CustomerProfile customer={mockCustomer} />
          </Paper>
        </Grid>

        {/* Key Metrics Section */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <CustomerKeyMetrics metrics={mockMetrics} />
          </Paper>
        </Grid>

        {/* Order History Section */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
             <Typography variant="h6" gutterBottom>Order History</Typography>
             <CustomerOrderHistory orders={mockOrders} />
          </Paper>
        </Grid>

        {/* Support History Section */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Support History</Typography>
            <CustomerSupportHistory tickets={mockTickets} />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Customer360Page;
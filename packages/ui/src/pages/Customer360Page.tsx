/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/Customer360Page.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import { Box, Grid, Paper, Typography, CircularProgress, Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { CustomerRFMInsights } from 'components/Customer360/CustomerRFMInsights';
import axios from 'axios';
// Import Child Components and their data types
import CustomerProfile, { CustomerProfileData } from 'components/Customer360/CustomerProfile.tsx';
import CustomerKeyMetrics, { CustomerMetricsData } from 'components/Customer360/CustomerKeyMetrics.tsx';
import CustomerOrderHistory, { CustomerOrder } from 'components/Customer360/CustomerOrderHistory.tsx';
import CustomerSupportHistory, { SupportTicket } from 'components/Customer360/CustomerSupportHistory.tsx';

import { CustomerBehaviorInsights } from 'components/Customer360/CustomerBehaviorInsights';
import { CustomerSessionHistory } from 'components/Customer360/CustomerSessionHistory';
import type { CustomerApiResponse } from 'api-src/api/customers/customers.service';

const mapApiMetricsToUiMetrics = (apiMetrics: any, orders: any[] = []): any => {
  // Get the last order date from orders array
  const lastOrder = orders && orders.length > 0 
    ? orders.reduce((latest, order) => 
        new Date(order.orderDate) > new Date(latest.orderDate) ? order : latest
      )
    : null;

  return {
    ltv: apiMetrics.ltv || 0,
    aov: apiMetrics.aov || 0,
    totalOrders: apiMetrics.total_orders || 0,
    totalMargin: apiMetrics.total_revenue ? apiMetrics.total_revenue * 0.3 : 0, // Estimate 30% margin
    lastOrderDate: lastOrder ? lastOrder.orderDate : null
  };
};

/**
 * Customer360Page: Displays the unified view for a single customer.
 * Fetches data using TanStack Query and renders child components.
 */
const Customer360Page: React.FC = () => {
  // --- Hooks ---
  const { id } = useParams<{ id: string }>(); // Get customer ID from URL parameter

  // --- Data Fetching Function ---
  /**
   * Fetches detailed data for a specific customer from the API.
   * Throws an error if customerId is missing or API call fails.
   */
  const fetchCustomerData = async (customerId: string | undefined): Promise<CustomerApiResponse> => {
    // Input validation
    if (!customerId) {
      throw new Error('Customer ID is required to fetch data.');
    }
    console.log(`Fetching data for customer: ${customerId}`); // Debug log
    // API call (Ensure this endpoint exists and returns the expected CustomerApiResponse structure)
    const { data } = await axios.get<CustomerApiResponse>(`/api/v1/customers/${customerId}`);
    console.log(`Successfully fetched data for customer: ${customerId}`, data); // Debug log
    return data;
  };

  // --- TanStack Query Hook ---
  const {
    data: customerData, // The fetched data (CustomerApiResponse | undefined)
    isLoading,         // True while the initial fetch is in progress
    isError,           // True if the query encountered an error
    error              // The error object if isError is true
  } = useQuery<CustomerApiResponse, Error>({
        // queryKey: A unique array identifying this specific query.
        // Includes 'customer' and the dynamic 'id'. Ensures data is refetched if 'id' changes.
        queryKey: ['customer', id],
        // queryFn: The async function that performs the data fetching.
        queryFn: () => fetchCustomerData(id),
        // enabled: Prevents the query from running automatically if 'id' is not yet available (e.g., during initial render).
        enabled: !!id,
        
        // By default, useQuery retries 3 times. Our test mocks a 404 (Not Found),
        // which should not be retried. This makes the 'isError' state
        // set immediately, allowing the test to find the alert.
        retry: (failureCount, error) => {
          // Use the built-in Axios type guard to check the error
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            return false; // Do not retry on 404
          }
          // For all other errors, use the default behavior (retry 3 times)
          return failureCount < 3;
        },
      });
  // --- End Data Fetching ---

  // --- Render Logic ---
  return (
    <Box sx={{ p: 2 }}>
      {/* Page Title */}
      <Typography variant="h4" gutterBottom>
        Details for Customer #{id}
      </Typography>

      {/* Loading State: Show a spinner while data is being fetched */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error State: Show an alert if fetching failed */}
      {isError && (
        <Alert severity="error" sx={{ my: 2 }}>
          Failed to load customer data: {error?.message}
        </Alert>
      )}

      {/* Success State: Render the main content grid when data is available */}
      {customerData && !isLoading && !isError && (
        <Grid container spacing={3}>
          {/* Profile Section */}
          <Grid size={{ xs: 12 }}>
            <Paper sx={{ p: 2, height: '100%' }}>
              <CustomerProfile customer={customerData.profile} />
            </Paper>
          </Grid>

          {/* Key Metrics Section */}
          <Grid size={{ xs: 12 }}>
            <Paper sx={{ p: 2, height: '100%' }}>
              <CustomerKeyMetrics metrics={mapApiMetricsToUiMetrics(customerData.metrics, customerData.orders)} />
            </Paper>
          </Grid>

          {/*  Specter Behavior Insights */}
          <Grid size={{ xs: 12, md: 6 }}>
            <CustomerBehaviorInsights customerId={id!} />
          </Grid>

          {/*  Session History */}
          <Grid size={{ xs: 12, md: 6 }}>
            <CustomerSessionHistory customerId={id!} />
          </Grid>

          {/*  RFM Insights */}
          <Grid size={{ xs: 12 }}>
             <CustomerRFMInsights customerData={customerData} />
          </Grid>

          {/* Order History Section */}
          <Grid size={{ xs: 12 }}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>Order History</Typography>
              <CustomerOrderHistory orders={customerData.orders || []} />
            </Paper>
          </Grid>

          {/* Support History Section */}
          <Grid size={{ xs: 12 }}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>Support History</Typography>
              <CustomerSupportHistory tickets={customerData.tickets || []} />
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default Customer360Page;
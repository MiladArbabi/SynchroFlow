/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/Customer360/CustomerOrderHistory.tsx
import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';

// Define the structure for a single order in the list
export interface CustomerOrder {
  id: string; // Ensure ID is string if DataGrid expects it
  orderDate: string; // Expecting ISO string date
  status: string;
  total: number;
}

interface CustomerOrderHistoryProps {
  orders: CustomerOrder[] | undefined | null; // Allow undefined for loading
  isLoading?: boolean;
}

/**
 * Formats a number as rounded USD currency.
 */
const formatRoundedCurrency = (value: number | undefined | null): string => {
  if (value === null || typeof value === 'undefined') return '$--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
};

/**
 * Formats an ISO date string into a simple format.
 */
const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '--';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateString));
  } catch (e) {
    return '--';
  }
};

// Define columns for the DataGrid
const columns: GridColDef<CustomerOrder>[] = [
  { field: 'id', headerName: 'Order ID', width: 150 },
  {
    field: 'orderDate',
    headerName: 'Date',
    width: 150,
    valueFormatter: (value: string | undefined | null) => formatDate(value),
  },
  { field: 'status', headerName: 'Status', width: 150 },
  {
    field: 'total',
    headerName: 'Total',
    type: 'number',
    width: 150,
    valueFormatter: (value: number | undefined | null) => formatRoundedCurrency(value),
    align: 'right', // Align currency to the right
    headerAlign: 'right',
  },
];

/**
 * A component displaying a customer's order history in a DataGrid.
 */
const CustomerOrderHistory: React.FC<CustomerOrderHistoryProps> = ({ orders, isLoading }) => {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 150 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
        No order history available.
      </Typography>
    );
  }

  return (
    // Set a height for the DataGrid container
    <Box sx={{ height: 400, width: '100%' }}>
      <DataGrid
        rows={orders.map(o => ({...o, id: String(o.id)}))} // Ensure ID is string
        columns={columns}
        initialState={{
          pagination: {
            paginationModel: { pageSize: 5, page: 0 },
          },
          sorting: { // Default sort by date descending
            sortModel: [{ field: 'orderDate', sort: 'desc' }],
          },
        }}
        pageSizeOptions={[5, 10, 25]}
        autoHeight={false} // Use the container's height
        density="compact"
        // onRowClick={(params) => console.log('Row clicked:', params.row.id)} // Add navigation later
        sx={{
            border: 'none',
            '& .MuiDataGrid-row:hover': {
                cursor: 'pointer',
            },
        }}
      />
    </Box>
  );
};

export default CustomerOrderHistory;
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/OrdersPage.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { DataGrid, GridColDef, GridRowParams } from '@mui/x-data-grid';
import MasterPanel from 'ui-component/MasterPanel/index.tsx';

// Define the structure of an Order (adjust based on actual API)
interface Order {
  id: string; // Ensure ID is string if that's what API returns
  customer_name: string;
  total: number;
  status: string;
  // Add other relevant fields for the list view
}

// Define columns for the DataGrid
const columns: GridColDef<Order>[] = [
  { field: 'id', headerName: 'Order ID', width: 150 },
  { field: 'customer_name', headerName: 'Customer', width: 250 },
  {
    field: 'total',
    headerName: 'Total',
    type: 'number',
    width: 150,
    valueFormatter: (value: number) =>
      value?.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
  },
  { field: 'status', headerName: 'Status', width: 150 },
];

/**
 * OrdersPage: Displays a list of orders in the MasterPanel.
 */
const OrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get<Order[]>('/api/v1/orders');
        // Ensure IDs are strings if DataGrid expects them
        setOrders(response.data.map(order => ({ ...order, id: String(order.id) })));
      } catch (err) {
        console.error('Failed to fetch orders:', err);
        setError('Failed to load orders.');
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []); // Fetch on mount

  const handleRowClick = (params: GridRowParams<Order>) => {
    navigate(`/orders/${params.row.id}`);
  };

  return (
    // Use MasterPanel with title "Orders"
    // MasterPanel already sets height: 100%
    <MasterPanel title="Orders">
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80%' }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Box sx={{ p: 2 }}>
           <Alert severity="error">{error}</Alert>
        </Box>
      )}
      {!loading && !error && (
        // DataGrid needs explicit height to fill the container
        <Box sx={{ height: 'calc(100vh - 150px)', width: '100%' }}>
           {/* Adjust height calculation based on header/padding */}
          <DataGrid
            rows={orders}
            columns={columns}
            onRowClick={handleRowClick}
            initialState={{
              pagination: {
                paginationModel: { pageSize: 25, page: 0 },
              },
            }}
            pageSizeOptions={[10, 25, 50]}
            // disableRowSelectionOnClick // Keep selection enabled for visual feedback
            sx={{
                border: 'none', // Remove default border
                '& .MuiDataGrid-row:hover': {
                    cursor: 'pointer', // Indicate rows are clickable
                },
            }}
          />
        </Box>
      )}
    </MasterPanel>
  );
};

export default OrdersPage;
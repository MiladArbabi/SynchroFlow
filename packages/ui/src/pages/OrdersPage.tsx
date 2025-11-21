// packages/ui/src/pages/OrdersPage.tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/OrdersPage.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { DataGrid, GridColDef, GridRowParams } from '@mui/x-data-grid';
import MasterPanel from 'ui-component/MasterPanel/index.tsx';

// Define the structure of an Order based on actual API response
interface Order {
  id: string; // platform_order_id from API
  customer_name: string;
  total: number;
  status: string;
  order_number: string;
  created_at: string;
}

// Define columns for the DataGrid
const columns: GridColDef<Order>[] = [
  { field: 'order_number', headerName: 'Order #', width: 120 },
  { field: 'customer_name', headerName: 'Customer', width: 200 },
  {
    field: 'total',
    headerName: 'Total',
    type: 'number',
    width: 130,
    valueFormatter: (value: number) =>
      value?.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
  },
  { field: 'status', headerName: 'Status', width: 130 },
  { 
    field: 'created_at', 
    headerName: 'Created', 
    width: 150,
    valueFormatter: (value: string) => 
      new Date(value).toLocaleDateString()
  },
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
        setOrders(response.data);
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
        <Box sx={{ height: 'calc(100vh - 150px)', width: '100%' }}>
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
            sx={{
                border: 'none',
                '& .MuiDataGrid-row:hover': {
                    cursor: 'pointer',
                },
            }}
          />
        </Box>
      )}
    </MasterPanel>
  );
};

export default OrdersPage;
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/CustomersPage.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { DataGrid, GridColDef, GridRowParams } from '@mui/x-data-grid';
import MasterPanel from 'ui-component/MasterPanel/index.tsx';

// Define the structure of a Customer for the list
interface Customer {
  id: string; // Ensure ID is string
  name: string;
  email: string;
  total_orders: number; // Example metric
  // Add other relevant fields for the list view
}

// Define columns for the DataGrid
const columns: GridColDef<Customer>[] = [
  { field: 'id', headerName: 'Customer ID', width: 150 },
  { field: 'name', headerName: 'Name', width: 250 },
  { field: 'email', headerName: 'Email', width: 250 },
  {
    field: 'total_orders',
    headerName: 'Total Orders',
    type: 'number',
    width: 150,
    align: 'right',
    headerAlign: 'right',
  },
];

/**
 * CustomersPage: Displays a list of customers in the MasterPanel.
 */
const CustomersPage: React.FC = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      setError(null);
      try {
        // This endpoint doesn't exist yet, will cause error in UI
        const response = await axios.get<Customer[]>('/api/v1/customers');
        // Ensure IDs are strings
        setCustomers(response.data.map(cust => ({ ...cust, id: String(cust.id) })));
      } catch (err) {
        console.error('Failed to fetch customers:', err);
        setError('Failed to load customers.');
      } finally {
        setLoading(false);
      }
    };
    fetchCustomers();
  }, []); // Fetch on mount

  const handleRowClick = (params: GridRowParams<Customer>) => {
    navigate(`/customers/${params.row.id}`);
  };

  return (
    <MasterPanel title="Customers">
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
           {/* Adjust height calculation */}
          <DataGrid
            rows={customers}
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

export default CustomersPage;
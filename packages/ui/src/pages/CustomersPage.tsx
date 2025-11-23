/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/CustomersPage.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { DataGrid, GridColDef, GridRowParams } from '@mui/x-data-grid';
import { useQuery } from '@tanstack/react-query';
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

  // --- Data Fetching with useQuery ---
  const fetchCustomers = async (): Promise<Customer[]> => {
    const { data } = await axios.get<Customer[]>('/api/v1/customers');
    // Ensure IDs are strings right after fetching
    return data.map(cust => ({ ...cust, id: String(cust.id) }));
  };

  const {
    data: customers, // Renamed data to customers
    isLoading,      // Use isLoading from useQuery
    isError,        // Use isError from useQuery
    error           // Use error from useQuery
  } = useQuery<Customer[], Error>({ // Add type safety
        queryKey: ['customers'], // Unique key for this query
        queryFn: fetchCustomers, // The function to fetch data
        // Optional: configure staleTime, gcTime etc. here if needed
      });
  // --- End Data Fetching ---

  const handleRowClick = (params: GridRowParams<Customer>) => {
    console.log('🔍 DEBUG CustomersPage - handleRowClick FIRED');
    const customerId = encodeURIComponent(params.row.id);
    console.log('📋 Row params ID:', params.row.id);
    console.log('🔐 Encoded ID:', customerId);
    console.log('🎯 Target URL:', `/customers/${customerId}`);
    console.log('📍 Current path:', window.location.pathname);
    console.log('🚀 CustomersPage - Navigating to customer:', params.row.id);
    console.log('📋 Row data:', params.row);
    navigate(`/customers/${params.row.id}`);
  };

  return (
    <MasterPanel title="Customers">
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80%' }}>
          <CircularProgress />
        </Box>
      )}
      {isError && (
        <Box sx={{ p: 2 }}>
           <Alert severity="error">Failed to load customers. {error?.message}</Alert>
        </Box>
      )}
      {!isLoading && !isError && customers && (
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
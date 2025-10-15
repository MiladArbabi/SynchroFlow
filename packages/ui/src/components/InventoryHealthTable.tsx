//packages/ui/src/components/InventoryHealthTable.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import MDBox from "components/MDBox";
import MDTypography from "components/MDTypography";

// Define the shape of our data
interface InventoryHealthRow {
  sku: string;
  quantity_available: number;
  status: 'Healthy' | 'At Risk' | 'Stockout';
}

// Define the columns for our Data Grid
const columns: GridColDef[] = [
  { field: 'sku', headerName: 'SKU', width: 250 },
  { field: 'quantity_available', headerName: 'Available Quantity', width: 150, type: 'number' },
  {
    field: 'status',
    headerName: 'Status',
    width: 150,
    // We can add custom rendering for colors later
  },
];

export const InventoryHealthTable: React.FC = () => {
  const [rows, setRows] = useState<InventoryHealthRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get('/api/v1/analytics/inventory-health?shop_id=1');
        // The DataGrid requires a unique 'id' for each row. We'll use the SKU.
        const dataWithIds = response.data.map((row: InventoryHealthRow) => ({ ...row, id: row.sku }));
        setRows(dataWithIds);
      } catch (error) {
        console.error("Failed to fetch inventory health:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <MDBox pt={3}>
        <MDTypography variant="h6" gutterBottom>
            Inventory Health Monitor
        </MDTypography>
        <MDBox sx={{ height: 400, width: '100%' }}>
            <DataGrid
                rows={rows}
                columns={columns}
                loading={isLoading}
                initialState={{
                    pagination: {
                        paginationModel: { page: 0, pageSize: 5 },
                    },
                }}
                pageSizeOptions={[5, 10]}
            />
        </MDBox>
    </MDBox>
  );
};
//packages/ui/src/components/InventoryHealthTable.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MDBox from "./MDBox";
import MDTypography from "./MDTypography";
import { DataTable } from './DataTable'; // Import our new generic component
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';

// Define the shape of our data
interface InventoryHealthRow {
  sku: string;
  quantity_available: number;
  status: 'Healthy' | 'At Risk' | 'Stockout';
}

// Define columns using the TanStack Table helper
const columnHelper = createColumnHelper<InventoryHealthRow>();
const columns: ColumnDef<InventoryHealthRow, unknown>[] = [
  columnHelper.accessor('sku', { header: 'SKU', cell: info => info.getValue() }),
  columnHelper.accessor('quantity_available', { header: 'Available Quantity', cell: info => info.getValue() }),
  columnHelper.accessor('status', { header: 'Status', cell: info => info.getValue() }),
];

export const InventoryHealthTable: React.FC = () => {
  const [data, setData] = useState<InventoryHealthRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get<InventoryHealthRow[]>('/api/v1/analytics/inventory-health?shop_id=1');
        setData(response.data);
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
      <MDBox mb={1}>
        <MDTypography variant="h6">
          Inventory Health Monitor
        </MDTypography>
      </MDBox>
      {isLoading ? (
        <MDTypography>Loading...</MDTypography>
      ) : (
        <DataTable columns={columns} data={data} />
      )}
    </MDBox>
  );
};
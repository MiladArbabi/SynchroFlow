//packages/ui/src/components/InventoryHealthTable.tsx
import React from 'react';
import { Box } from '@mui/material';
import { DataTable } from './DataTable'; // Import our new generic component
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import {Typography} from '@mui/material';

// Define the shape of our data
export interface InventoryHealthRow {
  sku: string;
  quantity_available: number;
  status: 'Healthy' | 'At Risk' | 'Stockout';
}

interface InventoryHealthTableProps {
  data: InventoryHealthRow[];
}

// Define columns using the TanStack Table helper
const columnHelper = createColumnHelper<InventoryHealthRow>();
const columns: ColumnDef<InventoryHealthRow, unknown>[] = [
  columnHelper.accessor('sku', { header: 'SKU', cell: info => info.getValue() }),
  columnHelper.accessor('quantity_available', { header: 'Available Quantity', cell: info => info.getValue() }),
  columnHelper.accessor('status', { header: 'Status', cell: info => info.getValue() }),
];

export const InventoryHealthTable: React.FC<InventoryHealthTableProps> = ({ data }) => {
  return (
    <Box pt={3}>
      <Box mb={1}>
        <Typography variant="h6">
          Inventory Health Monitor
        </Typography>
      </Box>
      <DataTable columns={columns} data={data} />
    </Box>
  );
};
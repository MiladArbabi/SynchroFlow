/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/widgets/InventoryHealthWidget.tsx
import React from 'react';
import {
    Box,
    Chip,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography
} from '@mui/material';
import { useTheme } from '@mui/material/styles'; // Import useTheme
import MainCard from 'ui-component/cards/MainCard'; // Use our MainCard

// Define the row data type
export interface InventoryHealthRow {
  sku: string;
  quantity_available: number;
  status: 'Healthy' | 'At Risk' | 'Stockout';
}

// Define the props for the widget
interface InventoryHealthWidgetProps {
  data: InventoryHealthRow[];
}

// Helper to get status chip colors
const getStatusChip = (theme: any, status: InventoryHealthRow['status']) => {
    let color: 'success' | 'warning' | 'error' = 'success';
    if (status === 'At Risk') color = 'warning';
    if (status === 'Stockout') color = 'error';

    return (
        <Chip
            label={status}
            size="small"
            // Use the 'light' variant we defined in the theme overrides!
            variant="light"
            color={color}
             // Ensure text contrasts
            sx={{ color: `${color}.dark` }}
        />
    );
};


const InventoryHealthWidget: React.FC<InventoryHealthWidgetProps> = ({ data }) => {
   const theme = useTheme();

   return (
        // Use MainCard as the wrapper
        <MainCard
            title="Inventory Health" // Set the title
            content={false} // We will use TableContainer, so no default content padding
            sx={{ height: '100%' }}
        >
            {/* Use MuiTableContainer for scrolling if needed */}
            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>SKU</TableCell>
                            <TableCell align="right">Qty. Available</TableCell>
                            <TableCell align="center">Status</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {data.map((row) => (
                            <TableRow
                                key={row.sku}
                                hover // Add hover effect
                            >
                                <TableCell>
                                    <Typography variant="body2">{row.sku}</Typography>
                                </TableCell>
                                <TableCell align="right">
                                    <Typography variant="body2" fontWeight="bold">
                                        {row.quantity_available.toLocaleString()}
                                    </Typography>
                                </TableCell>
                                <TableCell align="center">
                                    {getStatusChip(theme, row.status)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </MainCard>
   );
};

export default InventoryHealthWidget;
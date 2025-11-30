// apps/frontend/src/components/Customer360/CustomerOrderHistory.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import CustomerOrderHistory, { CustomerOrder } from './CustomerOrderHistory'; // Import the component

const meta: Meta<typeof CustomerOrderHistory> = {
  title: 'SynchroFlow/Customer360/CustomerOrderHistory',
  component: CustomerOrderHistory,
  decorators: [
    (Story) => (
      <Box sx={{ p: 2, height: 450 }}> {/* Ensure height for DataGrid */}
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'],
  argTypes: {
    isLoading: { control: 'boolean' }
  }
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample data matching the test
const sampleOrders: CustomerOrder[] = [
  { id: '1002', orderDate: '2025-10-20T14:00:00Z', status: 'Shipped', total: 75.50 },
  { id: '1001', orderDate: '2025-09-15T10:30:00Z', status: 'Delivered', total: 50.00 },
  { id: '1003', orderDate: '2025-10-25T08:00:00Z', status: 'Pending', total: 120.00 },
  { id: '1004', orderDate: '2025-08-01T11:00:00Z', status: 'Delivered', total: 30.25 },
];

// --- Stories ---

export const Default: Story = {
  args: {
    orders: sampleOrders,
    isLoading: false,
  },
};

export const Loading: Story = {
  args: {
    orders: undefined,
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    orders: [],
    isLoading: false,
  },
};

export const NoData: Story = {
  args: {
    orders: null, // Test null state
    isLoading: false,
  },
};
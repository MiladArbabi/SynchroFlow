// apps/frontend/src/components/Customer360/CustomerKeyMetrics.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import CustomerKeyMetrics, { CustomerMetricsData } from './CustomerKeyMetrics'; // Import the component

const meta: Meta<typeof CustomerKeyMetrics> = {
  title: 'SynchroFlow/Customer360/CustomerKeyMetrics',
  component: CustomerKeyMetrics,
  decorators: [
    (Story) => (
      <Box sx={{ p: 2, maxWidth: 800 }}> {/* Wider container */}
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample data matching the test
const sampleMetrics: CustomerMetricsData = {
  ltv: 1204.50,
  aov: 110.40,
  totalOrders: 11,
  totalMargin: 550.25,
  lastOrderDate: '2025-10-15T09:30:00Z',
};

const partialMetrics: Partial<CustomerMetricsData> = {
  ltv: 55.00,
  totalOrders: 1,
  // Other metrics are missing
};

// --- Stories ---

export const Default: Story = {
  args: {
    metrics: sampleMetrics,
  },
};

export const PartialData: Story = {
  args: {
    // Cast to ensure type compatibility
    metrics: partialMetrics as CustomerMetricsData,
  },
};

export const Unavailable: Story = {
  args: {
    metrics: null, // Test the null state
  },
};
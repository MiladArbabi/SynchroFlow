// packages/ui/src/widgets/OrderProfitability/OrderProfitability.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import OrderProfitability, { OrderProfitabilityData } from '.'; // Import the component

// Metadata for the story
const meta: Meta<typeof OrderProfitability> = {
  title: 'SynchroFlow/Widgets/OrderProfitability', // How it appears in Storybook navigation
  component: OrderProfitability,
  decorators: [ // Optional: Add padding/max-width for better viewing in Storybook
    (Story) => (
      <Box sx={{ p: 2, maxWidth: 400 }}>
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'], // Enables automatic documentation generation
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample data for different scenarios
const profitableData: OrderProfitabilityData = {
  revenue: 149.99,
  cogs: 62.50,
  shippingCost: 12.00,
  fees: 4.50,
  margin: 70.99,
  marginPercent: 47.33,
};

const lossData: OrderProfitabilityData = {
  revenue: 25.00,
  cogs: 20.00,
  shippingCost: 8.00,
  fees: 1.50,
  margin: -4.50,
  marginPercent: -18.00,
};

// --- Stories ---

// Story for a profitable order
export const Profitable: Story = {
  args: {
    data: profitableData,
  },
};

// Story for an order with a loss
export const Loss: Story = {
  args: {
    data: lossData,
  },
};

// Story for when data is unavailable
export const Unavailable: Story = {
  args: {
    data: null, // Test the null state
  },
};
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/ui-component/WmsStatusStepper/WmsStatusStepper.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import WmsStatusStepper, { OrderStatus } from '.'; // Import the new component
import { Box } from '@mui/material';

const meta: Meta<typeof WmsStatusStepper> = {
  title: 'SynchroFlow/WmsStatusStepper',
  component: WmsStatusStepper,
  decorators: [
    (Story) => (
      <Box sx={{ p: 3 }}>
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'],
  argTypes: {
    currentStatus: {
      control: 'select',
      options: ['Pending', 'Picking', 'Packed', 'Shipped'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    currentStatus: 'Pending',
  },
};

export const Picking: Story = {
  args: {
    currentStatus: 'Picking',
  },
};

export const Packed: Story = {
  args: {
    currentStatus: 'Packed',
  },
};

export const Shipped: Story = {
  args: {
    currentStatus: 'Shipped',
  },
};
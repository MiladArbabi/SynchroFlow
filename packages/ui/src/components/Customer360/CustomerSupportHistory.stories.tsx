/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/Customer360/CustomerSupportHistory.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box, Paper } from '@mui/material'; // Use Paper for better visual context
import CustomerSupportHistory, { SupportTicket } from './CustomerSupportHistory'; // Import the component

const meta: Meta<typeof CustomerSupportHistory> = {
  title: 'SynchroFlow/Customer360/CustomerSupportHistory',
  component: CustomerSupportHistory,
  decorators: [
    (Story) => (
      // Wrap in Paper for realistic background and padding
      <Paper sx={{ p: 2, maxWidth: 600 }}>
        <Story />
      </Paper>
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
const sampleTickets: SupportTicket[] = [
  { id: 'TKT-501', subject: 'Question about Shipping Speed Options Provided for Order #12399', date: '2025-10-25T11:00:00Z', status: 'Pending' },
  { id: 'TKT-498', subject: 'Return Request - SF-TS-BLK-M - Damaged on Arrival', date: '2025-10-22T16:30:00Z', status: 'Resolved' },
  { id: 'TKT-495', subject: 'Login Issue - Password Reset Not Working', date: '2025-10-21T09:15:00Z', status: 'Closed' },
];

// --- Stories ---

export const Default: Story = {
  args: {
    tickets: sampleTickets,
    isLoading: false,
  },
};

export const Loading: Story = {
  args: {
    tickets: undefined,
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    tickets: [],
    isLoading: false,
  },
};

export const NoData: Story = {
  args: {
    tickets: null, // Test null state
    isLoading: false,
  },
};
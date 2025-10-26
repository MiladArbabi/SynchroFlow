// packages/ui/src/components/Customer360/CustomerProfile.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import CustomerProfile, { CustomerProfileData } from './CustomerProfile'; // Import the component

const meta: Meta<typeof CustomerProfile> = {
  title: 'SynchroFlow/Customer360/CustomerProfile',
  component: CustomerProfile,
  decorators: [
    (Story) => (
      <Box sx={{ p: 2, maxWidth: 400 }}>
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// --- Mock Data ---
const mockCustomerFull: CustomerProfileData = {
  name: 'John Doe',
  email: 'john.doe@example.com',
  phone: '555-1234',
  tags: ['VIP', 'High Return Rate', 'Newsletter Subscriber'],
  shippingAddress: {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zip: '12345',
    country: 'USA',
  },
  billingAddress: {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zip: '12345',
    country: 'USA',
  },
  accountCreated: '2024-01-15T10:00:00Z',
  source: 'Shopify',
};

const mockCustomerPartial: CustomerProfileData = {
  name: 'Jane Smith',
  email: 'jane.smith@sample.net',
  phone: null,
  tags: ['New Customer'],
  shippingAddress: {
    street: '456 Oak Ave',
    city: 'Otherville',
    state: 'NY',
    zip: '67890',
    country: 'USA',
  },
  billingAddress: null, // Billing different or missing
};

// --- Stories ---
export const FullProfile: Story = {
  args: {
    customer: mockCustomerFull,
  },
};

export const PartialProfile: Story = {
  args: {
    customer: mockCustomerPartial,
  },
};

export const BillingDifferent: Story = {
  args: {
    customer: {
        ...mockCustomerFull,
        billingAddress: {
            street: 'PO Box 999',
            city: 'Somewhere',
            state: 'TX',
            zip: '54321',
            country: 'USA',
        }
    },
  },
};


export const NoTags: Story = {
  args: {
    customer: {
        ...mockCustomerPartial,
        tags: [], // Empty array
    },
  },
};

export const Unavailable: Story = {
  args: {
    customer: null, // Test the null state
  },
};
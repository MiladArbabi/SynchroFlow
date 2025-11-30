import type { Meta, StoryObj } from '@storybook/react';
import { CustomerRFMInsights } from '../components/Customer360/CustomerRFMInsights';
import type { CustomerApiResponse } from 'api-src/api/customers/customers.service';

const meta = {
  title: 'Customer360/RFMInsights',
  component: CustomerRFMInsights,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof CustomerRFMInsights>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock data for different segments
const championCustomer: CustomerApiResponse = {
  id: '123',
  profile: {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    location: 'New York',
    joined_date: '2023-01-15T00:00:00.000Z',
    tags: ['vip', 'repeat-customer']
  },
  metrics: {
    total_revenue: 2500,
    total_orders: 12,
    aov: 208.33,
    ltv: 3000
  },
  orders: [
    {
      id: 'order1',
      orderDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'fulfilled',
      total: 300
    },
    {
      id: 'order2', 
      orderDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'fulfilled',
      total: 450
    }
  ],
  tickets: [],
  resolution: null
};

const atRiskCustomer: CustomerApiResponse = {
  id: '456',
  profile: {
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1234567891',
    location: 'Los Angeles',
    joined_date: '2022-06-01T00:00:00.000Z',
    tags: []
  },
  metrics: {
    total_revenue: 800,
    total_orders: 4,
    aov: 200,
    ltv: 960
  },
  orders: [
    {
      id: 'order1',
      orderDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'fulfilled',
      total: 200
    }
  ],
  tickets: [],
  resolution: null
};

export const ChampionCustomer: Story = {
  args: {
    customerData: championCustomer
  }
};

export const AtRiskCustomer: Story = {
  args: {
    customerData: atRiskCustomer
  }
};

export const NoData: Story = {
  args: {
    customerData: null
  }
};
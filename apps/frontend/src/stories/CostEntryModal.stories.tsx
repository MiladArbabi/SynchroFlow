// apps/frontend/src/stories/CostEntryModal.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { CostEntryModal } from '../components/CostEntryModal';

const meta: Meta<typeof CostEntryModal> = {
  title: 'Cost Data Entry/CostEntryModal',
  component: CostEntryModal,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof CostEntryModal>;

const mockProduct = {
  id: 1,
  shop_id: 1,
  platform_product_id: 'prod_123',
  title: 'Premium Widget',
  vendor: 'Acme Corp',
  product_type: 'Widget',
  status: 'active',
  total_inventory: 25,
  created_at: '2024-01-01',
  updated_at: '2024-01-01'
};

export const Default: Story = {
  args: {
    open: true,
    product: mockProduct,
    onClose: () => console.log('Modal closed'),
    onSave: (costData) => console.log('Cost data saved:', costData),
  },
};

export const WithCostData: Story = {
  args: {
    open: true,
    product: mockProduct,
    onClose: () => console.log('Modal closed'),
    onSave: (costData) => console.log('Cost data saved:', costData),
  },
};

export const NoProduct: Story = {
  args: {
    open: false,
    product: null,
    onClose: () => console.log('Modal closed'),
    onSave: (costData) => console.log('Cost data saved:', costData),
  },
};
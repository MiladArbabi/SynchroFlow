// packages/ui/src/stories/CostStatusIndicator.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { CostStatusIndicator } from '../components/CostStatusIndicator';

const meta: Meta<typeof CostStatusIndicator> = {
  title: 'Cost Data Entry/CostStatusIndicator',
  component: CostStatusIndicator,
};

export default meta;
type Story = StoryObj<typeof CostStatusIndicator>;

const mockProduct = {
  id: 1,
  platform_product_id: 'prod_123',
  title: 'Premium Widget',
};

export const NoCostData: Story = {
  args: {
    product: mockProduct,
    onClick: () => console.log('Add cost clicked'),
  },
};

export const WithCostData: Story = {
  args: {
    product: mockProduct,
    onClick: () => console.log('Edit cost clicked'),
  },
};
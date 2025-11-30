// apps/frontend/src/components/onboarding/TrustBridge.stories.tsx
import { Meta, StoryObj } from '@storybook/react';
import { TrustBridge } from './TrustBridge';

const meta: Meta<typeof TrustBridge> = {
  title: 'Onboarding/TrustBridge',
  component: TrustBridge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: '400px' }}>
      <TrustBridge />
    </div>
  ),
};
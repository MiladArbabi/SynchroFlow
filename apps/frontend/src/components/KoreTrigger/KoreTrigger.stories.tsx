// apps/frontend/src/components/KoreTrigger/KoreTrigger.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import KoreTrigger from './index';

const meta: Meta<typeof KoreTrigger> = {
  title: 'Components/KoreTrigger',
  component: KoreTrigger,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    isActive: {
      control: 'boolean',
      description: 'Controls the active state animation',
    },
    onClick: { action: 'clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof KoreTrigger>;

export const Inactive: Story = {
  args: {
    isActive: false,
  },
};

export const Active: Story = {
  args: {
    isActive: true,
  },
};

// Interactive story for testing hover effects
export const Interactive: Story = {
  args: {
    isActive: false,
  },
  parameters: {
    pseudo: {
      hover: true, // Enables hover state in Storybook controls
    },
  },
};
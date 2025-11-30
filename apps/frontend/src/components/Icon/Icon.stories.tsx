// apps/frontend/src/components/Icon/Icon.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import IconComponent from '.';
import { icons } from 'lucide-react'; // Import names for argTypes

const iconNames = Object.keys(icons) as (keyof typeof icons)[];

const meta: Meta<typeof IconComponent> = {
  title: 'Components/Icon',
  component: IconComponent,
  tags: ['autodocs'],
  argTypes: {
    name: {
      control: 'select',
      options: iconNames,
    },
    color: {
      control: 'select',
      options: [
        'inherit', 'primary', 'secondary', 'info', 'success',
        'warning', 'error', 'light', 'dark', 'text', 'white'
      ],
    },
    size: {
      control: 'select',
      options: ['xs', 'small', 'medium', 'large', 'xl'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof IconComponent>;

export const Default: Story = {
  args: {
    name: 'Menu', // Default icon
    color: 'primary',
    size: 'medium',
  },
};

export const LargeError: Story = {
    args: {
      name: 'AlarmClock',
      color: 'error',
      size: 'large',
    },
  };

export const SmallText: Story = {
    args: {
      name: 'Users',
      color: 'text',
      size: 'small',
    },
  };
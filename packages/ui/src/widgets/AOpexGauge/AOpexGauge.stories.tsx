// packages/ui/src/widgets/AOpexGauge/AOpexGauge.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import AOpexGauge from '.'; // Import the new component

const meta: Meta<typeof AOpexGauge> = {
  title: 'SynchroFlow/Widgets/AOpexGauge',
  component: AOpexGauge,
  decorators: [
    (Story) => (
      <Box sx={{ p: 3, width: 300 }}>
        <Story />
      </Box>
    )
  ],
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    value: { control: 'number' },
    target: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Opex Saved (Monthly)',
    value: 8125,
    target: 10000,
  },
};

export const OverTarget: Story = {
  args: {
    title: 'Opex Saved (YTD)',
    value: 120000,
    target: 100000,
  },
};

export const LowProgress: Story = {
  args: {
    title: 'Opex Saved (Weekly)',
    value: 150,
    target: 1000,
  },
};
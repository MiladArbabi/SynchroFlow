// apps/frontend/src/components/EchoHub/EchoHubRightPane.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import EchoHubRightPane from './EchoHubRightPane'; // Import the component

const meta: Meta<typeof EchoHubRightPane> = {
  title: 'SynchroFlow/EchoHub/EchoHubRightPane',
  component: EchoHubRightPane,
  decorators: [
    // Provide a container with a fixed height/width for context
    (Story) => (
      <Box sx={{ width: 600, height: 700, border: '1px dashed grey' }}>
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Default story rendering the component
export const Default: Story = {
  args: {
    // No props needed for the static version
  },
};
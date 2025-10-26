// packages/ui/src/components/EchoHub/EchoHubMiddlePane.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import EchoHubMiddlePane from './EchoHubMiddlePane'; // Import the component

const meta: Meta<typeof EchoHubMiddlePane> = {
  title: 'SynchroFlow/EchoHub/EchoHubMiddlePane',
  component: EchoHubMiddlePane,
  decorators: [
    // Provide a container with a fixed height/width for context
    (Story) => (
      <Box sx={{ width: 350, height: 600, border: '1px dashed grey' }}>
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Default story rendering the component with its internal mock data
export const Default: Story = {
  args: {
    // No props needed for the static version
  },
};
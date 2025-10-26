// packages/ui/src/components/EchoHub/EchoHubLeftPane.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import EchoHubLeftPane from './EchoHubLeftPane';

const meta: Meta<typeof EchoHubLeftPane> = {
  title: 'SynchroFlow/EchoHub/EchoHubLeftPane',
  component: EchoHubLeftPane,
  decorators: [
    // Provide a container with a fixed height/width for context
    (Story) => (
      <Box sx={{ width: 250, height: 500, border: '1px dashed grey' }}>
        <Story />
      </Box>
    ),
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Default story
export const Default: Story = {
  args: {
    // No props needed for the static version
  },
};
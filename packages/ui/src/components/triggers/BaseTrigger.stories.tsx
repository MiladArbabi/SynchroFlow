// packages/ui/src/components/triggers/BaseTrigger.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { BaseTrigger } from './BaseTrigger';
import { Box, Typography, Button } from '@mui/material';

const meta: Meta<typeof BaseTrigger> = {
  title: 'ACI/Triggers/BaseTrigger',
  component: BaseTrigger,
  tags: ['autodocs'],
  argTypes: {
    triggerType: {
      control: 'select',
      options: ['coach', 'action', 'automation', 'orchestration'],
    },
    onFeedback: { action: 'feedback' },
  },
};

export default meta;
type Story = StoryObj<typeof BaseTrigger>;

const MockContent = () => (
  <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
    <Typography variant="h6">Profit Margin Alert</Typography>
    <Typography variant="body2">
      Your profit margin dropped by 2% due to increased shipping costs.
    </Typography>
    <Button variant="outlined" size="small" sx={{ mt: 1 }}>
      View Analysis
    </Button>
  </Box>
);

export const Default: Story = {
  args: {
    insightId: 'test-insight-1',
    triggerType: 'coach',
    children: <MockContent />,
  },
};

export const WithFeedback: Story = {
  args: {
    ...Default.args,
    feedbackEnabled: true,
  },
};

export const WithGovernance: Story = {
  args: {
    ...Default.args,
    requiresApproval: true,
    approvalWorkflow: 'Large PO Approval',
    confidenceScore: 0.92,
    reasoning: ['Historical accuracy: 98%', 'Supplier data verified'],
  },
};

export const FullFeatured: Story = {
  args: {
    ...WithGovernance.args,
    feedbackEnabled: true,
  },
};
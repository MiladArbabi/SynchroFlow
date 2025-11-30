// apps/frontend/src/components/triggers/CoachTrigger.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { CoachTrigger } from './CoachTrigger';
import { Typography, Paper } from '@mui/material';

const meta: Meta<typeof CoachTrigger> = {
  title: 'ACI/Triggers/CoachTrigger',
  component: CoachTrigger,
  tags: ['autodocs'],
  argTypes: {
    onFeedback: { action: 'feedback' },
  },
};

export default meta;
type Story = StoryObj<typeof CoachTrigger>;

const FunnelChartMock = () => (
  <Paper variant="outlined" sx={{ p: 2, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f8fafc' }}>
    <Typography variant="caption" color="text.secondary">[ Funnel Visualization Placeholder ]</Typography>
  </Paper>
);

export const Default: Story = {
  args: {
    insightId: 'coach-1',
    title: 'Recover Abandoned Carts',
    tactic: 'Implement Exit Intent Popup',
    successMetrics: ['Conversion Rate', 'Revenue Recovery'],
    estimatedImpact: '+15% Revenue',
    children: <FunnelChartMock />,
  },
};

export const CostReduction: Story = {
  args: {
    insightId: 'coach-2',
    title: 'Optimize Shipping Costs',
    tactic: 'Switch to Regional Carriers',
    successMetrics: ['Shipping Margin', 'Bottom Line'],
    estimatedImpact: '-12% Shipping Cost', // Should show as success color due to logic
    children: <FunnelChartMock />,
    feedbackEnabled: true,
  },
};

export const WithGovernance: Story = {
  args: {
    ...Default.args,
    confidenceScore: 0.89,
    reasoning: ['Based on 500 similar stores', 'Industry benchmark data'],
    requiresApproval: false, // Coaching usually doesn't require approval, but good to test inheritance
  },
};
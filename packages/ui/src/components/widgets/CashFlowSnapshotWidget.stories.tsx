// packages/ui/src/components/widgets/CashFlowSnapshotWidget.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { CashFlowSnapshotWidget } from './CashFlowSnapshotWidget';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from 'contexts/AuthContext';

// Create a client for Storybook
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

// Mock Auth Decorator to bypass PostHog/LocalStorage
const MockAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const mockAuthValue = {
    isLoggedIn: true,
    isLoading: false,
    user: { 
      id: 1, 
      email: 'demo@synchroflow.com', 
      first_name: 'Demo', 
      last_name: 'User',
      role: 'owner',
      // --- FIX: Added missing timestamp fields required by PublicUser type ---
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), 
    },
    accessToken: 'mock-storybook-token',
    login: () => {},
    logout: () => {},
    setAccessToken: () => {},
  };

  // The error happens here because mockAuthValue matches the shape required by AuthContext
  return (
    <AuthContext.Provider value={mockAuthValue}>
      {children}
    </AuthContext.Provider>
  );
};

const meta: Meta<typeof CashFlowSnapshotWidget> = {
  title: 'ACI/Widgets/CashFlowSnapshotWidget',
  component: CashFlowSnapshotWidget,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <MockAuthProvider>
          <Story />
        </MockAuthProvider>
      </QueryClientProvider>
    ),
  ],
  argTypes: {
    onFeedback: { action: 'feedback-submitted' },
  },
};

export default meta;
type Story = StoryObj<typeof CashFlowSnapshotWidget>;

// 1. Default State (Legacy/No Insight)
export const LegacyView: Story = {
  args: {
    title: 'Cash Flow',
    // No insightId provided -> Should perform like the old widget
  },
};

// 2. Survival Mode (Negative Cash Flow Advice)
// Note: Without a mocked API, this will likely show the "Error" state inside the widget,
// BUT the CoachTrigger wrapper (Header, Tactic, Impact) should still be visible!
export const SurvivalModeRetrofit: Story = {
  args: {
    title: 'Cash Flow',
    insightId: 'cash-flow-survival',
    businessContext: { stage: 'survival', burningPriority: 'cash-flow' },
    metricConfig: { type: 'financial' },
  },
  parameters: {
    docs: {
      description: {
        story: 'Verifies that the widget is wrapped in a CoachTrigger. Even if data fails to load in Storybook, you should see the "Recommended Tactic" header.',
      },
    },
  },
};
// packages/ui/src/components/widgets/InventoryAlertsWidget.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { InventoryAlertsWidget } from './InventoryAlertsWidget';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from 'contexts/AuthContext';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Mock Auth Decorator
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    accessToken: 'mock-storybook-token',
    login: () => {},
    logout: () => {},
    setAccessToken: () => {},
  };

  return (
    <AuthContext.Provider value={mockAuthValue}>
      {children}
    </AuthContext.Provider>
  );
};

const meta: Meta<typeof InventoryAlertsWidget> = {
  title: 'ACI/Widgets/InventoryAlertsWidget',
  component: InventoryAlertsWidget,
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
type Story = StoryObj<typeof InventoryAlertsWidget>;

// 1. Legacy View
export const LegacyView: Story = {
  args: {
    title: 'Inventory Alerts',
    businessContext: { stage: 'survival', burningPriority: 'inventory' },
    metricConfig: { type: 'inventory' },
  },
};

// 2. Retrofit View (Will show Error state wrapped in CoachTrigger)
export const RetrofitView: Story = {
  args: {
    title: 'Inventory Alerts',
    insightId: 'inventory-alerts-demo',
    businessContext: { stage: 'survival', burningPriority: 'inventory' },
    metricConfig: { type: 'inventory' },
  },
  parameters: {
    docs: {
      description: {
        story: 'Verifies the CoachTrigger wrapper (Header, Tactic, Feedback) around the content.',
      },
    },
  },
};
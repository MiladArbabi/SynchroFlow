// apps/frontend/src/components/widgets/OrderMetricsWidget.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { OrderMetricsWidget } from './OrderMetricsWidget';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from 'contexts/AuthContext';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Mock Auth Decorator (Fixed with correct user shape)
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

const meta: Meta<typeof OrderMetricsWidget> = {
  title: 'ACI/Widgets/OrderMetricsWidget',
  component: OrderMetricsWidget,
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
type Story = StoryObj<typeof OrderMetricsWidget>;

// 1. Legacy View
export const LegacyView: Story = {
  args: {
    title: 'Order Metrics',
    businessContext: { stage: 'survival', burningPriority: 'acquisition' },
    metricConfig: { type: 'growth' },
  },
};

// 2. Retrofit View (Will show Error state wrapped in CoachTrigger)
export const RetrofitView: Story = {
  args: {
    title: 'Order Metrics',
    insightId: 'order-metrics-demo',
    businessContext: { stage: 'survival', burningPriority: 'acquisition' },
    metricConfig: { type: 'growth' },
  },
  parameters: {
    docs: {
      description: {
        story: 'Verifies the CoachTrigger wrapper (Header, Tactic, Feedback) around the content.',
      },
    },
  },
};
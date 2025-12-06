// apps/frontend/src/components/widgets/TopProductsWidget.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { TopProductsWidget } from './TopProductsWidget';
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
      email: 'demo@lasyncro.com', 
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

const meta: Meta<typeof TopProductsWidget> = {
  title: 'ACI/Widgets/TopProductsWidget',
  component: TopProductsWidget,
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
type Story = StoryObj<typeof TopProductsWidget>;

// 1. Legacy View
export const LegacyView: Story = {
  args: {
    title: 'Top Products',
    businessContext: { stage: 'survival', burningPriority: 'inventory' },
    metricConfig: { type: 'inventory' },
  },
};

// 2. Retrofit View (Will show Error state wrapped in CoachTrigger)
export const RetrofitView: Story = {
  args: {
    title: 'Top Products',
    insightId: 'top-products-demo',
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
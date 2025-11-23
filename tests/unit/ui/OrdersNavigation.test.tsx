// tests/unit/ui/OrdersNavigation.test.tsx
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrdersPage from 'pages/OrdersPage';
import Order360Page from 'pages/Order360Page';
import { Routes, Route } from 'react-router-dom';

const queryClient = new QueryClient();

describe('Orders Navigation', () => {
  test('navigates from orders list to order details', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<Order360Page />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Mock the API response for orders
    // This would need proper mocking setup
  });
});
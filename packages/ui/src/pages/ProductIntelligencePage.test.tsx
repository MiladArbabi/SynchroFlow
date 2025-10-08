// packages/ui/src/pages/ProductIntelligencePage.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductIntelligencePage } from './ProductIntelligencePage';
import axios from 'axios';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

test('renders the Product Intelligence page with a search bar and button', () => {
  render(
    <MemoryRouter>
      <ProductIntelligencePage />
    </MemoryRouter>
  );

  // Look for the search input field by its placeholder text
  expect(screen.getByPlaceholderText(/search by sku/i)).toBeInTheDocument();

  // Look for the search button
  expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
});

test('allows a user to search for a SKU and displays the inventory results', async () => {
  // --- 1. SETUP ---
  const testSku = 'TEST-123';
  // Define the fake data our API will return
  const fakeApiResponse = {
    inventory: {
      sku: testSku,
      quantity: 150,
      price: 29.99,
      location: 'Aisle 4, Bay 7'
    },
    forecast: { forecast: [] } // Forecast not needed for this test
  };
  // Tell our mock to return this fake data when called
  mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

  render(
    <MemoryRouter>
      <ProductIntelligencePage />
    </MemoryRouter>
  );

  // --- 2. EXECUTION ---
  // Simulate the user typing a SKU into the search box
  fireEvent.change(screen.getByPlaceholderText(/search by sku/i), { target: { value: testSku } });
  // Simulate the user clicking the search button
  fireEvent.click(screen.getByRole('button', { name: /search/i }));

  // --- 3. ASSERTION ---
  // Wait for the component to re-render with the data and check for the quantity
  expect(await screen.findByText(/150/)).toBeInTheDocument();
  expect(screen.getByText(/Aisle 4, Bay 7/i)).toBeInTheDocument();
});
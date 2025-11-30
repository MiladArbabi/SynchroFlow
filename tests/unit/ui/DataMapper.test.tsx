//apps/frontend/src/components/DataMapper/DataMapper.test.tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import DataMapper from 'components/DataMapper/DataMapper';

// Mock the axios module
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  mockedAxios.get.mockClear();
  mockedAxios.post.mockClear();
});

describe('DataMapper', () => {
  it('renders the main heading', () => {
    render(<DataMapper />);
    expect(screen.getByRole('heading', { name: /data mapping rules/i })).toBeInTheDocument();
  });

  it('fetches and displays mapping rules on mount', async () => {
    // 1. Setup the mock API response
    const mockRules = [
      { id: 1, shop_id: 1, source_platform: 'shopify', source_field_path: 'order.email', target_field_path: 'synchro.customer_email', created_at: '', updated_at: '' },
      { id: 2, shop_id: 1, source_platform: 'shopify', source_field_path: 'order.total_price', target_field_path: 'synchro.order_total', created_at: '', updated_at: '' },
    ];
    mockedAxios.get.mockResolvedValue({ data: mockRules });

    // 2. Render the component
    render(<DataMapper />);

    // 3. Assert that the data is eventually displayed
    // Use findByText which waits for the element to appear
    expect(await screen.findByText('order.email')).toBeInTheDocument();
    expect(screen.getByText('synchro.order_total')).toBeInTheDocument();

    // Verify axios was called correctly
    expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/mappings?shop_id=1');
  });

  it('allows a user to add a new mapping rule', async () => {
    const user = userEvent.setup();
    
    // Mock the initial GET call to return an empty array
    mockedAxios.get.mockResolvedValue({ data: [] });

    // Mock the POST call to simulate a successful creation
    const newRule = { id: 3, shop_id: 1, source_platform: 'shopify', source_field_path: 'order.new.path', target_field_path: 'synchro.new.path' };
    mockedAxios.post.mockResolvedValue({ data: newRule });

    render(<DataMapper />);

    // Find the input fields and the button
    const sourceInput = screen.getByLabelText(/source path/i);
    const targetInput = screen.getByLabelText(/target path/i);
    const addButton = screen.getByRole('button', { name: /add rule/i });

    // Simulate user typing into the fields
    await user.type(sourceInput, 'order.new.path');
    await user.type(targetInput, 'synchro.new.path');

    // Simulate user clicking the add button
    await user.click(addButton);

    // Assert that the new rule appears on the screen
    expect(await screen.findByText('order.new.path')).toBeInTheDocument();

    // Assert that axios.post was called with the correct data
    expect(mockedAxios.post).toHaveBeenCalledWith('/api/v1/mappings', {
      shop_id: 1, // Hardcoded for now
      source_platform: 'shopify', // Hardcoded for now
      source_field_path: 'order.new.path',
      target_field_path: 'synchro.new.path'
    });
  });

  it('allows a user to delete a mapping rule', async () => {
    const user = userEvent.setup();
    
    // 1. Setup: Start with two rules displayed on the screen
    const initialRules = [
      { id: 1, shop_id: 1, source_platform: 'shopify', source_field_path: 'order.email', target_field_path: 'synchro.customer_email' },
      { id: 2, shop_id: 1, source_platform: 'shopify', source_field_path: 'order.total_price', target_field_path: 'synchro.order_total' },
    ];
    mockedAxios.get.mockResolvedValue({ data: initialRules });

    // Mock the DELETE call to simulate a successful deletion
    mockedAxios.delete.mockResolvedValue({ status: 204 });

    render(<DataMapper />);

    // Wait for the initial rules to be rendered
    const rowToDelete = await screen.findByText('order.email');
    expect(screen.getByText('order.total_price')).toBeInTheDocument();

    // 2. Execution: Find the "Delete" button within the first rule's row and click it
    const row = rowToDelete.closest('tr')!;
    const deleteButton = within(row).getByRole('button', { name: /delete/i });
    
    // Mock window.confirm to automatically return true (simulate clicking "OK")
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
    
    await user.click(deleteButton);

    // 3. Assertion: Verify the rule is gone
    expect(screen.queryByText('order.email')).not.toBeInTheDocument();
    
    // Verify axios.delete was called correctly
    expect(mockedAxios.delete).toHaveBeenCalledWith('/api/v1/mappings/1');
  });
});
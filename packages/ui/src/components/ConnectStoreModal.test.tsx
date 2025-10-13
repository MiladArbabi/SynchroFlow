// packages/ui/src/components/ConnectStoreModal.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { ConnectStoreModal } from './ConnectStoreModal';

// Mock axios
jest.mock('axios');
const mockedAxiosPost = axios.post as jest.Mock;

describe('ConnectStoreModal', () => {
  it('renders the modal with the correct title when open', () => {
    // A simple onClose mock function for the test
    const handleClose = jest.fn();

    render(<ConnectStoreModal isOpen={true} onClose={handleClose} />);

    expect(screen.getByRole('heading', { name: /Connect a Data Source/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const handleClose = jest.fn();
    
    const { container } = render(<ConnectStoreModal isOpen={false} onClose={handleClose} />);
    
    expect(container).toBeEmptyDOMElement();
  });

  it('submits the form and calls the sync API endpoint', async () => {
    const user = userEvent.setup();
    const handleClose = jest.fn();
    mockedAxiosPost.mockResolvedValue({ status: 202 }); // Simulate a successful API call

    render(<ConnectStoreModal isOpen={true} onClose={handleClose} />);

    // Find the form elements
    const shopInput = screen.getByLabelText(/Shop Name/i);
    const tokenInput = screen.getByLabelText(/Admin API Access Token/i);
    const syncButton = screen.getByRole('button', { name: /Start Sync/i });

    // Simulate user input
    await user.type(shopInput, 'my-cool-store.myshopify.com');
    await user.type(tokenInput, 'shpat_testaccesstoken');

    // Simulate form submission
    await user.click(syncButton);

    // Assertions
    await waitFor(() => {
      // Check that our sync API was called with the correct data
      expect(mockedAxiosPost).toHaveBeenCalledWith('/api/v1/integrations/shopify/start-trial-sync', {
        shop: 'my-cool-store.myshopify.com',
        accessToken: 'shpat_testaccesstoken',
        shopId: 1, // Expect the hardcoded shopId
      });
    });

    // Check that the modal closed on success
    expect(handleClose).toHaveBeenCalled();
  });
  it('displays a progress view while the sync is in progress', async () => {
    const user = userEvent.setup();
    const handleClose = jest.fn();
    // Simulate a hanging API call that never resolves to test the "in-progress" state
    mockedAxiosPost.mockReturnValue(new Promise(() => {}));

    render(<ConnectStoreModal isOpen={true} onClose={handleClose} />);

    // Find and fill out the form
    await user.type(screen.getByLabelText(/Shop Name/i), 'test-shop.myshopify.com');
    await user.type(screen.getByLabelText(/Admin API Access Token/i), 'shpat_test-token');

    // Click the submit button
    await user.click(screen.getByRole('button', { name: /Start Sync/i }));

    // Assert that the "Syncing..." message is now visible
    expect(await screen.findByText(/Syncing your data.../i)).toBeInTheDocument();

    // Assert that the form inputs are now gone
    expect(screen.queryByLabelText(/Shop Name/i)).not.toBeInTheDocument();
  });
});
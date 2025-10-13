// packages/ui/src/components/ConnectStoreModal.test.tsx
import { render, screen } from '@testing-library/react';
import { ConnectStoreModal } from './ConnectStoreModal';

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
});
//tests/unit/ui/onboarding/TrustBridge.test.tsx
import { render, screen } from '@testing-library/react';
import { TrustBridge } from 'components/onboarding/TrustBridge';

// --- The Test Suite ---
describe('Onboarding: TrustBridge (Issue #711)', () => {

  /**
   * This is our initial "Red" test.
   * It will fail because the 'TrustBridge' component does not exist yet.
   */
  test('[RED] should render the core "read-only" trust message', () => {
    // Arrange: Try to render the non-existent component
    render(<TrustBridge />);

    // Act: Look for the key piece of copy from our SSOT
    const trustMessage = screen.getByText(/We only read, never write/i);

    // Assert: Check if the message is in the document
    // This will FAIL because the component doesn't exist.
    expect(trustMessage).toBeInTheDocument();
  });

});
// tests/unit/ui/pages/dashboard/PlatformFt1Card.intent.test.tsx

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlatformFt1Card } from 'pages/dashboard/PlatformFt1Card';

describe('PlatformFt1Card — intent emission', () => {
  it('emits START_ONBOARDING intent when CTA is clicked', () => {
    const onIntent = jest.fn();

    render(
      <PlatformFt1Card
        title="Store Connection"
        message="Connect your Shopify store"
        taskId="connect-store"
        onIntent={onIntent}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /connect/i })
    );

    expect(onIntent).toHaveBeenCalledWith({
      type: 'START_ONBOARDING',
      taskId: 'connect-store',
    });
  });

  it('does not render CTA when taskId is missing', () => {
    const onIntent = jest.fn();

    render(
      <PlatformFt1Card
        title="Store Connection"
        message="Waiting for store connection"
        onIntent={onIntent}
      />
    );

    expect(
      screen.queryByRole('button')
    ).toBeNull();
  });
});
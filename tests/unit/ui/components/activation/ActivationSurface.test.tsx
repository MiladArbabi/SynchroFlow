// tests/unit/ui/components/activation/ActivationSurface.test.tsx
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';
import '@testing-library/jest-dom';

import { ActivationSurface } from '@lasyncro/shared/ui';

describe('ActivationSurface (FT-1)', () => {
  it('renders the activation surface root and module identity', () => {
    renderWithTheme(
      <ActivationSurface
        moduleId="customers"
        integrationProvider="shopify"
      />
    );

    expect(
      screen.getByTestId('activation-surface')
    ).toBeInTheDocument();

    expect(
      screen.getByText(/customers/i)
    ).toBeInTheDocument();
  });

  it('renders an integration prompt placeholder', () => {
    renderWithTheme(
      <ActivationSurface
        moduleId="customers"
        integrationProvider="shopify"
      />
    );

    expect(
      screen.getByTestId('activation-connect-integration')
    ).toBeInTheDocument();
  });

  it('renders a vision preview section', () => {
    renderWithTheme(
      <ActivationSurface
        moduleId="customers"
        integrationProvider="shopify"
      />
    );

    expect(
      screen.getByTestId('activation-vision-preview')
    ).toBeInTheDocument();
  });

  it('changes rendered content based on moduleId', () => {
    renderWithTheme(
      <ActivationSurface
        moduleId="orders"
        integrationProvider="shopify"
      />
    );

    expect(
      screen.getByText(/orders/i)
    ).toBeInTheDocument();
  });
});

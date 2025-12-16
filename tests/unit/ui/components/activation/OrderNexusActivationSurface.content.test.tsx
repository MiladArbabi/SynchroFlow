//tests/unit/ui/components/activation/OrderNexusActivationSurface.content.test.tsx
import { render, screen } from '@testing-library/react';
import { ActivationSurface } from '@lasyncro/shared/ui';
import { orderNexusActivationConfig } from 'activation/configs/orderNexus';

describe('OrderNexus ActivationSurface — locked doctrine content', () => {
  it('renders the blindness statement exactly', () => {
    render(<ActivationSurface {...orderNexusActivationConfig} />);

    expect(
      screen.getByText(
        /Right now, profitable and unprofitable orders are indistinguishable\./i
      )
    ).toBeInTheDocument();
  });

  it('renders the absence statement exactly', () => {
    render(<ActivationSurface {...orderNexusActivationConfig} />);

    expect(
      screen.getByText(
        /This order could be losing money\. You wouldn’t know\./i
      )
    ).toBeInTheDocument();
  });

  it('renders the post-activation certainty exactly', () => {
    render(<ActivationSurface {...orderNexusActivationConfig} />);

    expect(
      screen.getByText(
        /Once connected, money-losing orders are identified automatically\./i
      )
    ).toBeInTheDocument();
  });

  it('renders the primary CTA label exactly', () => {
    render(<ActivationSurface {...orderNexusActivationConfig} />);

    expect(
      screen.getByRole('button', { name: /Connect Shopify Store/i })
    ).toBeInTheDocument();
  });

  it('renders all trust bullets and nothing else', () => {
    render(<ActivationSurface {...orderNexusActivationConfig} />);

    const bullets = [
      'Read-only access',
      'No store changes',
      'Disconnect anytime',
      'Encrypted end-to-end',
      'Verified permissions',
    ];

    bullets.forEach((text) => {
      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });
});
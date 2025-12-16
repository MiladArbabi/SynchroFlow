//tests/ui/components/activation/ActivationSurface.test.tsx
import { render, screen } from '@testing-library/react';
import { ActivationSurface } from '@lasyncro/shared/ui';

describe('ActivationSurface — canonical slot contract', () => {
  const baseConfig = {
    moduleId: 'order-nexus',
    identity: {
      title: 'Orders',
    },
    blindness: {
      content: 'Right now, profitable and unprofitable orders are indistinguishable.',
    },
    absenceProof: {
      content: 'This order could be losing money. You wouldn’t know.',
    },
    valueAfterActivation: {
      content: 'Once connected, money-losing orders are identified automatically.',
    },
    primaryCTA: {
      label: 'Connect Shopify Store',
      onActivate: jest.fn(),
    },
    trust: {
      bullets: [
        'Read-only access',
        'No store changes',
        'Disconnect anytime',
      ],
    },
  };

  it('renders the Blindness slot (mandatory)', () => {
    render(<ActivationSurface {...(baseConfig as any)} />);
    expect(
      screen.getByText(/indistinguishable/i)
    ).toBeInTheDocument();
  });

  it('throws if Blindness slot is missing', () => {
    const { blindness, ...invalidConfig } = baseConfig as any;
    expect(() =>
      render(<ActivationSurface {...invalidConfig} />)
    ).toThrow();
  });

  it('renders exactly one Primary CTA', () => {
    render(<ActivationSurface {...(baseConfig as any)} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/connect shopify/i);
  });

  it('throws if Trust slot is missing', () => {
    const { trust, ...invalidConfig } = baseConfig as any;
    expect(() =>
      render(<ActivationSurface {...invalidConfig} />)
    ).toThrow();
  });

  it('renders Trust immediately after the Primary CTA', () => {
    render(<ActivationSurface {...(baseConfig as any)} />);

    const cta = screen.getByRole('button');
    const trustText = screen.getByText(/read-only access/i);

    // DOM order assertion
    expect(
      cta.compareDocumentPosition(trustText) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('does not accept legacy marketing props (headline / description)', () => {
    expect(() =>
      render(
        <ActivationSurface
          moduleId="order-nexus"
          headline="Activate Orders"
          description="Marketing copy"
        />
      )
    ).toThrow();
  });
});
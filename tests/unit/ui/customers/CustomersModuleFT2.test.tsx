import { render, screen } from '@testing-library/react';
import {
  CustomersModuleFT2,
  CustomersModuleFT2Props,
} from '@lasyncro/customers';

describe('CustomersModuleFT2 — CTR-aware exposure', () => {
  const ctr1Props: CustomersModuleFT2Props = {
    context: {
      sessionsObserved: null, // CTR-0 / CTR-1 boundary
    },

    systemState: null,
    timeSignal: null,
  };

  const ctr2Props: CustomersModuleFT2Props = {
    context: {
      sessionsObserved: 240,
    },

    systemState: {
      status: 'healthy',
      confidence: 'high',
    },

    timeSignal: {
      trend: 'stable',
    },
  };

  it('CTR-1: renders readiness signal only', () => {
    render(<CustomersModuleFT2 {...ctr1Props} />);

    // CTR itself is allowed (meta-truth)
    expect(
      screen.getByText(/customer truth readiness/i)
    ).toBeInTheDocument();

    expect(screen.getByText(/CTR-/i)).toBeInTheDocument();
  });

  it('CTR-1: does NOT render customer truth', () => {
    render(<CustomersModuleFT2 {...ctr1Props} />);

    // No customer counts
    expect(screen.queryByText(/240/i)).toBeNull();

    // No system confidence
    expect(screen.queryByText(/high/i)).toBeNull();
    expect(screen.queryByText(/medium/i)).toBeNull();
    expect(screen.queryByText(/low/i)).toBeNull();

    // No trend
    expect(screen.queryByText(/stable/i)).toBeNull();
    expect(screen.queryByText(/improving/i)).toBeNull();
  });

  it('CTR-1: does NOT degrade suppressed truth with placeholders', () => {
    render(<CustomersModuleFT2 {...ctr1Props} />);

    expect(
      screen.queryByText((_, node) =>
        node?.textContent?.includes('—') ?? false
      )
    ).toBeNull();
  });

  it('CTR-2+: renders customer truth deterministically', () => {
    render(<CustomersModuleFT2 {...ctr2Props} />);

    expect(screen.getByText(/240/i)).toBeInTheDocument();
    expect(screen.getByText(/high/i)).toBeInTheDocument();
    expect(screen.getByText(/stable/i)).toBeInTheDocument();
  });
});

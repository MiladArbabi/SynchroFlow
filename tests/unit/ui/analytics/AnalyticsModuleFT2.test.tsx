//tests/unit/ui/analytics/AnalyticsModuleFT2.test.tsx

import React from 'react';
import { render, screen } from '@testing-library/react';
import { AnalyticsModuleFT2 } from '@lasyncro/analytics';
import type { AnalyticsModuleFT2Props } from '@lasyncro/analytics';

describe('AnalyticsModuleFT2', () => {
  it('renders deterministically with null-safe props', () => {
    const props: AnalyticsModuleFT2Props = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        signalsAnalyzed: null,
      },
      coherenceSignal: null,
      volatilitySignal: null,
      blindSpots: null,
      timeSignal: null,
    };

    render(<AnalyticsModuleFT2 {...props} />);

    expect(screen.getByText('Analytics (FT2)')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(5);
  });
});
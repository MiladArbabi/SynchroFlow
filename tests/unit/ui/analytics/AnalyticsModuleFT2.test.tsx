/**
 * AnalyticsModuleFT2 — Deterministic Rendering Tests
 * =================================================
 *
 * Purpose:
 * --------
 * These tests ensure Analytics FT2 remains:
 * - Read-only
 * - Passive
 * - Fully nullable
 * - Free of interpretation
 *
 * The UI must NEVER:
 * - Explain meaning
 * - Hide nulls
 * - Infer importance
 *
 * If these tests feel "too boring",
 * they are doing their job.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { AnalyticsModuleFT2 } from '@lasyncro/analytics';
import type { AnalyticsModuleFT2Props } from '@lasyncro/analytics';

describe('AnalyticsModuleFT2', () => {
  it('renders deterministically with null-safe observability props', () => {
    const props: AnalyticsModuleFT2Props = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        signalsObserved: null,
      },
      systemStatus: null,
      stabilityIndicator: null,
      dataCoverage: null,
      trendSignal: null,
    };

    render(<AnalyticsModuleFT2 {...props} />);

    // Title must always render
    expect(screen.getByText('Analytics (FT2)')).toBeInTheDocument();

    /**
     * We expect a fixed number of null placeholders.
     * If this count changes, the UI has started hiding or inferring meaning.
     */
    expect(screen.getAllByText('—')).toHaveLength(5);
  });
});
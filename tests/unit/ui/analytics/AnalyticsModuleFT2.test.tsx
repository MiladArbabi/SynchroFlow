/**
 * AnalyticsModuleFT2 — Deterministic Rendering Tests
 * =================================================
 *
 * Purpose:
 * --------
 * These tests lock the Analytics FT2 UI into its canonical contract.
 *
 * Analytics FT2 MUST remain:
 * - Read-only
 * - Passive
 * - Shape-stable
 * - Fully nullable
 * - Free of interpretation
 *
 * The UI must NEVER:
 * - Explain meaning
 * - Hide nulls
 * - Infer importance
 * - Add intelligence
 *
 * If these tests feel boring or redundant,
 * they are working as intended.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { AnalyticsModuleFT2 } from '@lasyncro/analytics';
import type { AnalyticsModuleFT2Props } from '@lasyncro/analytics';

describe('AnalyticsModuleFT2 (FT2 deterministic UI)', () => {
  it('renders deterministically with fully null FT2 props', () => {
  const props: AnalyticsModuleFT2Props = {
    context: {
      period: { from: '2025-01-01', to: '2025-01-31' },
    },
    outcome: null,
    trend: null,
  };

  render(<AnalyticsModuleFT2 {...props} />);

  expect(
    screen.getByTestId('analytics-ft2-root')
  ).toBeInTheDocument();

  expect(
    screen.getByText(/2025-01-01 → 2025-01-31/)
  ).toBeInTheDocument();

  expect(
    screen.getByText(/Outcome/i).parentElement
  ).toHaveTextContent('—');

  expect(
    screen.getByText(/Trend/i).parentElement
  ).toHaveTextContent('—');
});

it('renders concrete values without interpretation', () => {
  const props: AnalyticsModuleFT2Props = {
    context: {
      period: { from: '2025-02-01', to: '2025-02-28' },
    },
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' },
  };

  render(<AnalyticsModuleFT2 {...props} />);

  expect(
    screen.getByText((c) => c.includes('positive'))
  ).toBeInTheDocument();

  expect(
    screen.getByText((c) => c.includes('unknown'))
  ).toBeInTheDocument();

  expect(screen.queryByText('—')).toBeNull();
});
});
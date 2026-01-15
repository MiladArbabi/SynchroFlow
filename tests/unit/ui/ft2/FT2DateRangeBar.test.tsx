import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithTheme } from 'test-utils';
import { FT2DateRangeBar } from '@lasyncro/ui-ft2';

import type { FT2DateRange } from '@lasyncro/ui-ft2';

/**
 * Authoritative base range fixture.
 * No helpers. No factories. No date math.
 */
const BASE_RANGE: FT2DateRange = {
  preset: 'past_7_days',
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-01-07T23:59:59.999Z',
};

describe('FT2DateRangeBar — behavior contract (RED)', () => {
  it('renders without crashing', () => {
    renderWithTheme(
      <FT2DateRangeBar
        value={BASE_RANGE}
        onChange={jest.fn()}
      />
    );

    expect(
      document.querySelector('[data-ft2-date-range-bar]')
    ).toBeInTheDocument();
  });

  it('does not emit onChange on mount', () => {
    const onChange = jest.fn();

    renderWithTheme(
      <FT2DateRangeBar
        value={BASE_RANGE}
        onChange={onChange}
      />
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the active preset label only (collapsed state)', () => {
    renderWithTheme(
      <FT2DateRangeBar
        value={BASE_RANGE}
        onChange={jest.fn()}
      />
    );

    // Locks label mapping: past_7_days → "Past 7 days"
    expect(
      screen.getByText('Past 7 days')
    ).toBeInTheDocument();
  });

  it('expands preset list on click', async () => {
    const user = userEvent.setup();

    renderWithTheme(
      <FT2DateRangeBar
        value={BASE_RANGE}
        onChange={jest.fn()}
      />
    );

    await user.click(screen.getByText('Past 7 days'));

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Last week')).toBeInTheDocument();
    expect(screen.getAllByText('Past 7 days').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('This month')).toBeInTheDocument();
    expect(screen.getByText('Last month')).toBeInTheDocument();
    expect(screen.getByText('Past 30 days')).toBeInTheDocument();
    expect(screen.getByText('Custom range')).toBeInTheDocument();
  });

  it('emits a full FT2DateRange on preset selection', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderWithTheme(
      <FT2DateRangeBar
        value={BASE_RANGE}
        onChange={onChange}
      />
    );

    await user.click(screen.getByText('Past 7 days'));
    await user.click(screen.getByText('Today'));

    expect(onChange).toHaveBeenCalledTimes(1);

    expect(onChange.mock.calls[0][0]).toMatchObject({
      preset: 'today',
      from: expect.any(String),
      to: expect.any(String),
    });
  });

  it('collapses immediately after selecting a preset', async () => {
    const user = userEvent.setup();

    renderWithTheme(
      <FT2DateRangeBar
        value={BASE_RANGE}
        onChange={jest.fn()}
      />
    );

    await user.click(screen.getByText('Past 7 days'));
    await user.click(screen.getByText('Today'));

    // Menu must be gone
    expect(
      screen.queryByText('This week')
    ).not.toBeInTheDocument();
  });

  it('does not emit onChange when selecting custom range (until confirmed)', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderWithTheme(
      <FT2DateRangeBar
        value={BASE_RANGE}
        onChange={onChange}
      />
    );

    await user.click(screen.getByText('Past 7 days'));
    await user.click(screen.getByText('Custom range'));

    expect(onChange).not.toHaveBeenCalled();
  });
});
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';
import { FT2DualTimeSeries } from '@lasyncro/ui-ft2';

describe('FT2DualTimeSeries', () => {
  test('renders left and right series with shared dates', () => {
    renderWithTheme(
      <FT2DualTimeSeries
        left={[
          { date: '2024-01-01', value: 1 },
          { date: '2024-01-02', value: 2 },
        ]}
        right={[
          { date: '2024-01-01', value: 10 },
          { date: '2024-01-02', value: 20 },
        ]}
      />
    );

    const rows = screen.getAllByTestId('ft2-dual-timeseries-row');
    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent('2024-01-01');
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[0]).toHaveTextContent('10');
  });

  test('renders left series when right values are null', () => {
    renderWithTheme(
      <FT2DualTimeSeries
        left={[
          { date: '2024-01-01', value: 1 },
        ]}
        right={[
          { date: '2024-01-01', value: null },
        ]}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(
      screen.queryByTestId('ft2-dual-timeseries-right-value')
    ).not.toBeInTheDocument();
  });

  test('renders right series when left values are null', () => {
    renderWithTheme(
      <FT2DualTimeSeries
        left={[
          { date: '2024-01-01', value: null },
        ]}
        right={[
          { date: '2024-01-01', value: 10 },
        ]}
      />
    );

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(
      screen.queryByTestId('ft2-dual-timeseries-left-value')
    ).not.toBeInTheDocument();
  });

  test('renders empty state when both series are null', () => {
    renderWithTheme(
      <FT2DualTimeSeries
        left={null as any}
        right={null as any}
      />
    );

    expect(
      screen.getByTestId('ft2-empty-state')
    ).toBeInTheDocument();
  });

  test('renders frame when both series are empty arrays', () => {
    renderWithTheme(
      <FT2DualTimeSeries
        left={[]}
        right={[]}
      />
    );

    expect(
      screen.getByTestId('ft2-dual-timeseries-frame')
    ).toBeInTheDocument();
  });

  test('is deterministic across renders', () => {
    const props = {
      left: [{ date: '2024-01-01', value: 1 }],
      right: [{ date: '2024-01-01', value: 2 }],
    };

    const { container: a } = renderWithTheme(
      <FT2DualTimeSeries {...props} />
    );
    const { container: b } = renderWithTheme(
      <FT2DualTimeSeries {...props} />
    );

    expect(a.innerHTML).toEqual(b.innerHTML);
  });
});
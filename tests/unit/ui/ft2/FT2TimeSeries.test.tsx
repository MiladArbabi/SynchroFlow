import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';
import { FT2TimeSeries } from '@lasyncro/ui-ft2';

describe('FT2TimeSeries', () => {
  test('renders points in provided order', () => {
    renderWithTheme(
      <FT2TimeSeries
        series={[
          { date: '2024-01-01', value: 1 },
          { date: '2024-01-02', value: 2 },
        ]}
      />
    );

    const points = screen.getAllByTestId('ft2-timeseries-point');
    expect(points[0]).toHaveTextContent('2024-01-01');
    expect(points[0]).toHaveTextContent('1');
    expect(points[1]).toHaveTextContent('2024-01-02');
    expect(points[1]).toHaveTextContent('2');
  });

  test('renders gaps when values are null (no interpolation)', () => {
    renderWithTheme(
      <FT2TimeSeries
        series={[
          { date: '2024-01-01', value: 1 },
          { date: '2024-01-02', value: null },
          { date: '2024-01-03', value: 3 },
        ]}
      />
    );

    const gaps = screen.getAllByTestId('ft2-timeseries-gap');
    expect(gaps).toHaveLength(1);
  });

  test('renders axes frame when series is empty', () => {
    renderWithTheme(<FT2TimeSeries series={[]} />);
    expect(
      screen.getByTestId('ft2-timeseries-frame')
    ).toBeInTheDocument();
  });

  test('renders empty state when series is null', () => {
    renderWithTheme(<FT2TimeSeries series={null} />);
    expect(
      screen.getByTestId('ft2-empty-state')
    ).toBeInTheDocument();
  });

  test('renders zero values explicitly', () => {
    renderWithTheme(
      <FT2TimeSeries
        series={[
          { date: '2024-01-01', value: 0 },
        ]}
      />
    );
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  test('is deterministic across renders', () => {
    const props = {
      series: [
        { date: '2024-01-01', value: 1 },
        { date: '2024-01-02', value: 2 },
      ],
    };

    const { container: a } = renderWithTheme(<FT2TimeSeries {...props} />);
    const { container: b } = renderWithTheme(<FT2TimeSeries {...props} />);

    expect(a.innerHTML).toEqual(b.innerHTML);
  });
});
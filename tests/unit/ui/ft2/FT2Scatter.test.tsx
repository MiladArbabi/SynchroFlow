import React from 'react';
import { renderWithTheme } from 'test-utils';
import { screen } from '@testing-library/react';

import { FT2Scatter } from '@lasyncro/ui-ft2';

describe('FT2Scatter', () => {
  test('renders empty state when points is null', () => {
    renderWithTheme(<FT2Scatter points={null} />);
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('renders empty state when points array is empty', () => {
    renderWithTheme(<FT2Scatter points={[]} />);
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('renders empty state when all points are null', () => {
    renderWithTheme(
      <FT2Scatter
        points={[
          { x: null, y: null },
          { x: null, y: null },
        ]}
      />
    );
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('renders only valid points', () => {
    renderWithTheme(
      <FT2Scatter
        points={[
          { x: 1, y: 2 },
          { x: null, y: 3 },
          { x: 4, y: null },
          { x: 5, y: 6 },
        ]}
      />
    );

    expect(screen.getAllByTestId('ft2-scatter-point')).toHaveLength(2);
  });

  test('renders axis labels when provided', () => {
    renderWithTheme(
      <FT2Scatter
        xLabel="X Axis"
        yLabel="Y Axis"
        points={[{ x: 1, y: 2 }]}
      />
    );

    expect(screen.getByText('X Axis')).toBeInTheDocument();
    expect(screen.getByText('Y Axis')).toBeInTheDocument();
  });

  test('does not render axis labels when omitted', () => {
    renderWithTheme(
      <FT2Scatter points={[{ x: 1, y: 2 }]} />
    );

    expect(screen.queryByTestId('ft2-x-axis-label')).toBeNull();
    expect(screen.queryByTestId('ft2-y-axis-label')).toBeNull();
  });
});
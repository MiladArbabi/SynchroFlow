import React from 'react';
import { renderWithTheme } from 'test-utils';
import { screen } from '@testing-library/react';

import { FT2ImpactMatrix } from '@lasyncro/ui-ft2';

describe('FT2ImpactMatrix', () => {
  test('renders empty state when xLabels is null', () => {
    renderWithTheme(
      <FT2ImpactMatrix
        xLabels={null}
        yLabels={['A']}
        cells={[]}
      />
    );
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('renders empty state when yLabels is null', () => {
    renderWithTheme(
      <FT2ImpactMatrix
        xLabels={['X']}
        yLabels={null}
        cells={[]}
      />
    );
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('renders empty state when cells is null', () => {
    renderWithTheme(
      <FT2ImpactMatrix
        xLabels={['X']}
        yLabels={['Y']}
        cells={null}
      />
    );
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('renders matrix grid with placeholders for missing cells', () => {
    renderWithTheme(
      <FT2ImpactMatrix
        xLabels={['X1', 'X2']}
        yLabels={['Y1']}
        cells={[
          { x: 'X1', y: 'Y1', value: 5 },
        ]}
      />
    );

    expect(screen.getAllByTestId('ft2-impact-cell')).toHaveLength(2);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('renders null values as placeholder', () => {
    renderWithTheme(
      <FT2ImpactMatrix
        xLabels={['X']}
        yLabels={['Y']}
        cells={[
          { x: 'X', y: 'Y', value: null },
        ]}
      />
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('renders axis labels', () => {
    renderWithTheme(
      <FT2ImpactMatrix
        xLabels={['Products']}
        yLabels={['Systems']}
        cells={[
          { x: 'Products', y: 'Systems', value: 3 },
        ]}
      />
    );

    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Systems')).toBeInTheDocument();
  });
});
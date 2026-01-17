import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';
import { FT2Distribution } from '@lasyncro/ui-ft2';

describe('FT2Distribution', () => {
  test('renders buckets in provided order', () => {
    renderWithTheme(
      <FT2Distribution
        buckets={[
          { key: 'A', value: 3 },
          { key: 'B', value: 7 },
        ]}
      />
    );

    const labels = screen.getAllByTestId('ft2-distribution-bucket-label');
    expect(labels[0]).toHaveTextContent('A');
    expect(labels[1]).toHaveTextContent('B');

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  test('renders bucket label when value is null', () => {
    renderWithTheme(
      <FT2Distribution
        buckets={[
          { key: 'A', value: null },
        ]}
      />
    );

    expect(
      screen.getByTestId('ft2-distribution-bucket-label')
    ).toHaveTextContent('A');

    expect(
      screen.queryByTestId('ft2-distribution-bucket-value')
    ).not.toBeInTheDocument();
  });

  test('renders frame when buckets array is empty', () => {
    renderWithTheme(<FT2Distribution buckets={[]} />);
    expect(
      screen.getByTestId('ft2-distribution-frame')
    ).toBeInTheDocument();
  });

  test('renders empty state when buckets is null', () => {
    renderWithTheme(<FT2Distribution buckets={null} />);
    expect(
      screen.getByTestId('ft2-empty-state')
    ).toBeInTheDocument();
  });

  test('renders zero values explicitly', () => {
    renderWithTheme(
      <FT2Distribution
        buckets={[
          { key: 'Zero', value: 0 },
        ]}
      />
    );

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  test('is deterministic across renders', () => {
    const props = {
      buckets: [
        { key: 'A', value: 1 },
        { key: 'B', value: 2 },
      ],
    };

    const { container: a } = renderWithTheme(
      <FT2Distribution {...props} />
    );
    const { container: b } = renderWithTheme(
      <FT2Distribution {...props} />
    );

    expect(a.innerHTML).toEqual(b.innerHTML);
  });
});
import React from 'react';
import { renderWithTheme } from 'test-utils';
import { screen } from '@testing-library/react';
import { FT2Legend } from '@lasyncro/ui-ft2';

describe('FT2Legend', () => {
  test('renders nothing when items is null', () => {
    const { container } = renderWithTheme(
      <FT2Legend items={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when items is empty', () => {
    const { container } = renderWithTheme(
      <FT2Legend items={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders legend labels only', () => {
    renderWithTheme(
      <FT2Legend
        items={[
          { label: 'Series A' },
          { label: 'Series B' },
        ]}
      />
    );

    expect(screen.getByText('Series A')).toBeInTheDocument();
    expect(screen.getByText('Series B')).toBeInTheDocument();
  });
});
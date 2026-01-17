import React from 'react';
import { renderWithTheme } from 'test-utils';
import { screen } from '@testing-library/react';
import { FT2Stat } from '@lasyncro/ui-ft2';

describe('FT2Stat', () => {
  test('renders numeric value', () => {
    renderWithTheme(<FT2Stat value={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  test('renders string value verbatim', () => {
    renderWithTheme(<FT2Stat value="N/A" />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  test('renders label when provided', () => {
    renderWithTheme(<FT2Stat value={5} label="Orders" />);
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('does not render label placeholder when label is absent', () => {
    renderWithTheme(<FT2Stat value={5} />);
    expect(screen.queryByText(/label/i)).not.toBeInTheDocument();
  });

  test('renders empty state when value is null', () => {
    renderWithTheme(<FT2Stat value={null} />);
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('is deterministic across renders', () => {
    const { container: first } = renderWithTheme(<FT2Stat value={10} />);
    const { container: second } = renderWithTheme(<FT2Stat value={10} />);
    expect(first.innerHTML).toEqual(second.innerHTML);
  });

  test('does not infer or compute anything', () => {
    renderWithTheme(<FT2Stat value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
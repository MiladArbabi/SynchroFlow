import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';
import { FT2Ratio } from '@lasyncro/ui-ft2';

describe('FT2Ratio', () => {
  test('renders numerator and denominator when both present', () => {
    renderWithTheme(<FT2Ratio numerator={5} denominator={10} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  test('renders label when provided', () => {
    renderWithTheme(
      <FT2Ratio numerator={3} denominator={7} label="Coverage" />
    );
    expect(screen.getByText('Coverage')).toBeInTheDocument();
  });

  test('renders numerator when denominator is null', () => {
    renderWithTheme(<FT2Ratio numerator={5} denominator={null} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  test('renders denominator when numerator is null', () => {
    renderWithTheme(<FT2Ratio numerator={null} denominator={10} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  test('renders empty state when both values are null', () => {
    renderWithTheme(<FT2Ratio numerator={null} denominator={null} />);
    expect(screen.getByTestId('ft2-empty-state')).toBeInTheDocument();
  });

  test('does not compute or infer a ratio', () => {
    renderWithTheme(<FT2Ratio numerator={1} denominator={2} />);
    expect(screen.queryByText(/50%|0\.5|\/|:/)).not.toBeInTheDocument();
  });

  test('is deterministic across renders', () => {
    const { container: a } = renderWithTheme(
      <FT2Ratio numerator={2} denominator={4} />
    );
    const { container: b } = renderWithTheme(
      <FT2Ratio numerator={2} denominator={4} />
    );
    expect(a.innerHTML).toEqual(b.innerHTML);
  });
});
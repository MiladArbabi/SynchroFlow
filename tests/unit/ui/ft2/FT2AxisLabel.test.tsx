import { renderWithTheme } from 'test-utils';
import { screen } from '@testing-library/react';
import { FT2AxisLabel } from '@lasyncro/ui-ft2';

describe('FT2AxisLabel', () => {
  test('renders nothing when label is null', () => {
    const { container } = renderWithTheme(
      <FT2AxisLabel label={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when label is empty', () => {
    const { container } = renderWithTheme(
      <FT2AxisLabel label="" />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders label text when provided', () => {
    renderWithTheme(<FT2AxisLabel label="Revenue" />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
  });
});
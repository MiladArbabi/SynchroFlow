//tests/unit/ui/components/KoreIcon/index.test.tsx
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// This import will fail
import { KoreIcon } from 'components/KoreIcon';

describe('KoreIcon', () => {
  it('should render the custom SVG icon', () => {
    render(<KoreIcon />);
    // We'll give the SVG a specific test ID
    expect(screen.getByTestId('kore-icon-svg')).toBeInTheDocument();
  });

  it('should not have the active class by default', () => {
    render(<KoreIcon />);
    // The animation class will be 'kore-icon-active'
    expect(screen.getByTestId('kore-icon-svg')).not.toHaveClass('kore-icon-active');
  });

  it('should apply the active class when isActive is true', () => {
    render(<KoreIcon isActive={true} />);
    expect(screen.getByTestId('kore-icon-svg')).toHaveClass('kore-icon-active');
  });
});
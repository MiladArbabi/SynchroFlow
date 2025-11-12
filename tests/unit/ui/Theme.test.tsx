// File: tests/unit/ui/Theme.test.tsx
import { render, screen } from '@testing-library/react';
import { useTheme } from '@mui/material/styles';
import ThemeCustomization from 'themes/index';


/**
 * A helper component to render theme values.
 * We render inside a provider, so we can use the useTheme hook.
 */
const TestThemeConsumer = () => {
  const theme = useTheme();
  
  // Render the actual hex codes into the DOM for testing
  return (
    <div>
      <div data-testid="error-main-color">{theme.palette.error.main}</div>
      <div data-testid="warning-main-color">{theme.palette.warning.main}</div>
      <div data-testid="success-main-color">{theme.palette.success.main}</div>
      <div data-testid="primary-main-color">{theme.palette.primary.main}</div>
    </div>
  );
};

// --- The Test Suite ---
describe('Theme Token Implementation (Issue #710)', () => {

  /**
   * This is our initial "Red" test.
   * It will fail because the 'baseColors' object in 'presetColors.ts'
   * has not been updated with our new SSOT 'emotional' colors yet.
   */
  test('[RED] palette.error.main should be the new SSOT "urgent" color', () => {
    // Arrange: Render the test component inside our *real* theme provider
    render(
      <ThemeCustomization>
        <TestThemeConsumer />
      </ThemeCustomization>
    );

    // Act: Find the rendered color value
    const errorColorElement = screen.getByTestId('error-main-color');

    // Assert: Check if it matches the new SSOT color
    // This will FAIL. It will get '#f44336' but expects '#DC2626'.
    expect(errorColorElement.textContent).toBe('#DC2626'); 
  });

});
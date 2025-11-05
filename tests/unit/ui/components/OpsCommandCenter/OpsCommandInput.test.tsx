//tests/unit/ui/components/OpsCommandCenter/OpsCommandInput.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { KoreIcon } from 'components/KoreIcon';
import { OpsCommandInput } from 'components/OpsCommandCenter/OpsCommandInput';

describe('OpsCommandInput', () => {
  // Create mock functions to pass as props
  const mockOnSearchChange = jest.fn();
  const mockOnKeyDown = jest.fn();
  const inputRef = React.createRef<HTMLInputElement>();

  beforeEach(() => {
    // Reset mocks before each test
    mockOnSearchChange.mockClear();
    mockOnKeyDown.mockClear();
  });

  it('should render the input with a placeholder', () => {
    render(
      <OpsCommandInput
        ref={inputRef}
        searchQuery=""
        onSearchChange={mockOnSearchChange}
        onKeyDown={mockOnKeyDown}
        isExecuting={false}
        isConsoleOpen={true}
      />
    );
    
    // We'll use a data-testid for the input
    const input = screen.getByTestId('kore-command-input');
    expect(input).toBeInTheDocument();
    
    // Check that our custom KoreIcon is rendered
    expect(screen.getByTestId('kore-icon-svg')).toBeInTheDocument();
    expect(input).toHaveAttribute(
      'placeholder',
      "Ask Kore..."
    );
  });

  it('should call onSearchChange when user types', () => {
    render(
      <OpsCommandInput
        ref={inputRef}
        searchQuery=""
        onSearchChange={mockOnSearchChange}
        onKeyDown={mockOnKeyDown}
        isExecuting={false}
        isConsoleOpen={true}
      />
    );

    const input = screen.getByTestId('kore-command-input');
    fireEvent.change(input, { target: { value: 'hello' } });

    expect(mockOnSearchChange).toHaveBeenCalledTimes(1);
    expect(mockOnSearchChange).toHaveBeenCalledWith('hello');
  });

  it('should call onKeyDown when user presses a key', () => {
    render(
      <OpsCommandInput
        ref={inputRef}
        searchQuery=""
        onSearchChange={mockOnSearchChange}
        onKeyDown={mockOnKeyDown}
        isExecuting={false}
        isConsoleOpen={true}
      />
    );

    const input = screen.getByTestId('kore-command-input');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(mockOnKeyDown).toHaveBeenCalledTimes(1);
  });

  it('should be disabled when isExecuting is true', () => {
    render(
      <OpsCommandInput
        ref={inputRef}
        searchQuery=""
        onSearchChange={mockOnSearchChange}
        onKeyDown={mockOnKeyDown}
        isExecuting={true} // <-- Set to true
        isConsoleOpen={true}
      />
    );

    const input = screen.getByTestId('kore-command-input');
    expect(input).toBeDisabled();
  });
});
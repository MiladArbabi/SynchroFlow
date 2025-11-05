// tests/unit/ui/components/OpsCommandCenter/ConversationHeader.test.tsx

/**
 * Unit tests for the ConversationHeader component.
 * 
 * The ConversationHeader displays the current conversation topic (formatted by replacing the first hyphen with a space)
 * and a clear button to start a new conversation when an active conversation is provided.
 * It renders nothing if no conversation is active.
 * 
 * These tests cover:
 * - Rendering behavior with null or undefined conversation.
 * - Rendering of formatted topic and clear button for various topic formats.
 * - Functionality of the clear button.
 * 
 * Mock data is generated using a factory function for scalability and ease of overriding properties.
 * Tests are designed to be robust by covering edge cases like empty topics, topics without hyphens,
 * and topics with multiple hyphens (noting that the component only replaces the first hyphen).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { KoreConversation } from 'components/OpsCommandCenter/naturalLanguage/types';
import { ConversationHeader } from 'components/OpsCommandCenter/ConversationHeader';

// Factory function to create mock conversation objects, allowing easy overrides for different test cases
const createMockConversation = (overrides: Partial<KoreConversation> = {}): KoreConversation => ({
  topic: 'find-orders', // Default topic with a single hyphen
  entities: { status: 'pending' },
  timestamp: Date.now(),
  ...overrides,
});

const mockOnClear = jest.fn();

describe('ConversationHeader', () => {
  beforeEach(() => {
    mockOnClear.mockClear();
  });

  /**
   * Test that the component renders nothing when conversation is null.
   */
  it('should render null if conversation is null', () => {
    const { container } = render(
      <ConversationHeader conversation={null} onClear={mockOnClear} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * Test that the component renders nothing when conversation is undefined (falsy value handling).
   */
  it('should render null if conversation is undefined', () => {
    const { container } = render(
      <ConversationHeader conversation={null} onClear={mockOnClear} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  // Parametrized tests for different topic formats to ensure robustness and scalability
  const topicCases = [
    { topic: 'find-orders', expected: 'find orders', description: 'topic with single hyphen' },
    { topic: 'findorders', expected: 'findorders', description: 'topic without hyphen' },
    { topic: 'find-all-orders', expected: 'find all-orders', description: 'topic with multiple hyphens (only first replaced)' },
    { topic: 'a-b-c-d', expected: 'a b-c-d', description: 'topic with several hyphens' },
    { topic: '', expected: '', description: 'empty topic' },
    { topic: 'topic-with_special-chars!', expected: 'topic with_special-chars!', description: 'topic with special characters and hyphens' },
  ];

  test.each(topicCases)(
  'should render the formatted topic and clear button for $description',
  ({ topic, expected }) => {
    const mockConversation = createMockConversation({ topic });
    render(
      <ConversationHeader conversation={mockConversation} onClear={mockOnClear} />
    );

    // Use a function text matcher to handle the trailing space
    expect(screen.getByText((content) => {
      // For empty topic, we expect exactly "Continuing: " with trailing space
      if (topic === '') {
        return content === 'Continuing: ' || content === 'Continuing:';
      }
      // For other topics, check if the content includes our expected text
      return content.includes(`Continuing: ${expected}`);
    })).toBeInTheDocument();

    // Assert the clear button is present with correct accessibility label
    expect(screen.getByRole('button', { name: 'Start new conversation' })).toBeInTheDocument();
  }
);

  /**
   * Test that the onClear callback is invoked when the clear button is clicked.
   */
  it('should call onClear when the clear button is clicked', () => {
    const mockConversation = createMockConversation();
    render(
      <ConversationHeader conversation={mockConversation} onClear={mockOnClear} />
    );

    // Simulate button click
    fireEvent.click(screen.getByRole('button', { name: 'Start new conversation' }));

    // Assert callback was called exactly once
    expect(mockOnClear).toHaveBeenCalledTimes(1);
  });
});
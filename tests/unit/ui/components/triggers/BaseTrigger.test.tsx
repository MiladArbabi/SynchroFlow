// tests/unit/ui/components/triggers/BaseTrigger.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { BaseTrigger } from 'components/triggers/BaseTrigger';
import { BaseTriggerProps, TriggerType } from 'components/triggers/types';
import { renderWithTheme } from 'test-utils';

// Test data
const mockBaseProps: BaseTriggerProps = {
  insightId: 'test-insight-123',
  triggerType: 'coach',
  feedbackEnabled: false,
  children: <div data-testid="test-children">Test Content</div>
};

const mockFeedbackHandler = jest.fn();

describe('BaseTrigger Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== BASIC RENDERING TESTS =====
  describe('Basic Rendering', () => {
    test('should render children correctly', () => {
      renderWithTheme(<BaseTrigger {...mockBaseProps} />);
      
      expect(screen.getByTestId('test-children')).toBeInTheDocument();
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    test('should include correct data attributes', () => {
      renderWithTheme(<BaseTrigger {...mockBaseProps} />);
      
      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-insight-id', 'test-insight-123');
      expect(wrapper).toHaveAttribute('data-trigger-type', 'coach');
    });

    test('should handle all trigger types', () => {
      const triggerTypes: TriggerType[] = ['coach', 'action', 'automation', 'orchestration'];
      
      triggerTypes.forEach(triggerType => {
        const { unmount } = renderWithTheme(
          <BaseTrigger {...mockBaseProps} triggerType={triggerType} />
        );
        
        expect(screen.getByTestId('base-trigger-wrapper')).toHaveAttribute(
          'data-trigger-type', 
          triggerType
        );
        unmount();
      });
    });
  });

  // ===== FEEDBACK FUNCTIONALITY TESTS =====
  describe('Feedback Functionality', () => {
    test('should not render feedback UI when feedbackEnabled is false', () => {
      renderWithTheme(<BaseTrigger {...mockBaseProps} feedbackEnabled={false} />);
      
      expect(screen.queryByTestId('feedback-ui')).not.toBeInTheDocument();
      expect(screen.queryByText('Was this helpful?')).not.toBeInTheDocument();
    });

    test('should render feedback UI when feedbackEnabled is true', () => {
      // This test will initially FAIL (RED) because feedback UI is not implemented
      renderWithTheme(
        <BaseTrigger 
          {...mockBaseProps} 
          feedbackEnabled={true}
          onFeedback={mockFeedbackHandler}
        />
      );
      
      expect(screen.getByTestId('feedback-ui')).toBeInTheDocument();
      expect(screen.getByText('Was this helpful?')).toBeInTheDocument();
    });

    test('should call onFeedback when feedback action is clicked', async () => {
      renderWithTheme(
        <BaseTrigger 
          {...mockBaseProps} 
          feedbackEnabled={true}
          onFeedback={mockFeedbackHandler}
        />
      );

      const helpfulButton = screen.getByTestId('feedback-helpful');
      fireEvent.click(helpfulButton);

      await waitFor(() => {
        expect(mockFeedbackHandler).toHaveBeenCalledWith(
          'test-insight-123',
          'accepted'
        );
      });
    });

    test('should handle feedback with reason when provided', async () => {
        renderWithTheme(
        <BaseTrigger 
            {...mockBaseProps} 
            feedbackEnabled={true}
            onFeedback={mockFeedbackHandler}
        />
        );

        const notHelpfulButton = screen.getByTestId('feedback-not-helpful');
        fireEvent.click(notHelpfulButton);

        // Should show reason selection
        expect(screen.getByTestId('feedback-reasons')).toBeInTheDocument();

        const reasonButton = screen.getByTestId('feedback-reason-not_relevant');
        fireEvent.click(reasonButton);

        // FIX: Need to click the submit button to complete the feedback flow
        const submitButton = screen.getByTestId('feedback-submit');
        fireEvent.click(submitButton);

        await waitFor(() => {
        expect(mockFeedbackHandler).toHaveBeenCalledWith(
            'test-insight-123',
            'dismissed',
            {
            reason: 'not_relevant',
            context: ''
            }
        );
        });
    });
});

  // ===== GOVERNANCE FEATURES TESTS =====
  describe('Governance Features', () => {
    test('should include confidence score when provided', () => {
      renderWithTheme(
        <BaseTrigger 
          {...mockBaseProps} 
          confidenceScore={0.85}
        />
      );
      
      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-confidence-score', '0.85');
    });

    test('should handle undefined confidence score', () => {
      renderWithTheme(<BaseTrigger {...mockBaseProps} />);
      
      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-confidence-score', '');
    });

    test('should include reasoning when provided', () => {
        const reasoning = ['Data trend analysis', 'Historical pattern matching'];
        
        renderWithTheme(
        <BaseTrigger 
            {...mockBaseProps} 
            reasoning={reasoning}
        />
        );
        
        expect(screen.getByTestId('reasoning-list')).toBeInTheDocument();
        
        // FIX: Use regex to match text that includes the bullet point
        expect(screen.getByText(/Data trend analysis/)).toBeInTheDocument();
        expect(screen.getByText(/Historical pattern matching/)).toBeInTheDocument();
        
        // Alternative: Check that the reasoning list contains the items
        const reasoningList = screen.getByTestId('reasoning-list');
        expect(reasoningList).toHaveTextContent('Data trend analysis');
        expect(reasoningList).toHaveTextContent('Historical pattern matching');
    });
    });

  // ===== APPROVAL WORKFLOW TESTS =====
  describe('Approval Workflow', () => {
    test('should indicate when approval is required', () => {
      renderWithTheme(
        <BaseTrigger 
          {...mockBaseProps} 
          requiresApproval={true}
          approvalWorkflow="budget-approval"
        />
      );
      
      // This test will initially FAIL (RED) because approval workflow UI is not implemented
      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-requires-approval', 'true');
      expect(wrapper).toHaveAttribute('data-approval-workflow', 'budget-approval');
    });

    test('should handle approval workflow without required approval', () => {
      renderWithTheme(
        <BaseTrigger 
          {...mockBaseProps} 
          requiresApproval={false}
          approvalWorkflow="auto-approval"
        />
      );
      
      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-requires-approval', 'false');
    });
  });

  // ===== ACCESSIBILITY TESTS =====
  describe('Accessibility', () => {
    test('should have proper ARIA labels for feedback controls', () => {
      renderWithTheme(
        <BaseTrigger 
          {...mockBaseProps} 
          feedbackEnabled={true}
        />
      );
      
      // This test will initially FAIL (RED) because feedback UI is not implemented
      expect(screen.getByRole('group', { name: 'Provide feedback on this insight' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'This was helpful' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'This was not helpful' })).toBeInTheDocument();
    });

    test('should maintain focus management in feedback flow', async () => {
        renderWithTheme(
        <BaseTrigger 
            {...mockBaseProps} 
            feedbackEnabled={true}
        />
        );
        
        const notHelpfulButton = screen.getByTestId('feedback-not-helpful');
        fireEvent.click(notHelpfulButton);

        // Should move focus to the FIRST reason selection (not_relevant)
        await waitFor(() => {
        expect(screen.getByTestId('feedback-reason-not_relevant')).toHaveFocus();
        });
    });
    });

  // ===== EDGE CASES AND ERROR HANDLING =====
  describe('Edge Cases and Error Handling', () => {
    test('should handle empty children', () => {
      const propsWithEmptyChildren = {
        ...mockBaseProps,
        children: null
      };

      expect(() => {
        renderWithTheme(<BaseTrigger {...propsWithEmptyChildren} />);
      }).not.toThrow();
    });

    test('should handle very long insight IDs', () => {
      const longInsightId = 'insight-'.repeat(50) + '123';
      
      renderWithTheme(
        <BaseTrigger 
          {...mockBaseProps} 
          insightId={longInsightId}
        />
      );
      
      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-insight-id', longInsightId);
    });

    test('should handle missing onFeedback callback when feedback is enabled', () => {
      // Should not throw when feedback is enabled but onFeedback is not provided
      expect(() => {
        renderWithTheme(
          <BaseTrigger 
            {...mockBaseProps} 
            feedbackEnabled={true}
          />
        );
      }).not.toThrow();
    });
  });
});
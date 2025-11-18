// tests/unit/ui/components/triggers/CoachTrigger.test.tsx
import { screen, fireEvent } from '@testing-library/react';
import { CoachTrigger } from 'components/triggers/CoachTrigger';
import { CoachTriggerProps } from 'components/triggers/types';
import { renderWithTheme } from 'test-utils';

// Test data
const mockCoachProps: CoachTriggerProps = {
  insightId: 'coach-insight-123',
  tactic: 'Exit Intent Popup',
  successMetrics: ['AOV', 'Conversion Rate'],
  estimatedImpact: '+15% Revenue',
  children: <div data-testid="coach-content">Coach Content</div>,
  feedbackEnabled: false
};

const mockFeedbackHandler = jest.fn();

describe('CoachTrigger Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== BASIC RENDERING TESTS =====
  describe('Basic Rendering', () => {
    test('should render children correctly', () => {
      renderWithTheme(<CoachTrigger {...mockCoachProps} />);
      
      expect(screen.getByTestId('coach-content')).toBeInTheDocument();
      expect(screen.getByText('Coach Content')).toBeInTheDocument();
    });

    test('should include coach-specific data attributes', () => {
      renderWithTheme(<CoachTrigger {...mockCoachProps} />);
      
      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-insight-id', 'coach-insight-123');
      expect(wrapper).toHaveAttribute('data-trigger-type', 'coach');
    });

    test('should display tactic information', () => {
      renderWithTheme(<CoachTrigger {...mockCoachProps} />);
      
      expect(screen.getByTestId('coach-tactic')).toHaveTextContent('Exit Intent Popup');
      expect(screen.getByTestId('coach-success-metrics')).toHaveTextContent('AOV, Conversion Rate');
      expect(screen.getByTestId('coach-impact')).toHaveTextContent('+15% Revenue');
    });

    test('should render optional title when provided', () => {
      const propsWithTitle = { ...mockCoachProps, title: 'Revenue Optimization' };
      renderWithTheme(<CoachTrigger {...propsWithTitle} />);
      
      expect(screen.getByTestId('coach-title')).toHaveTextContent('Revenue Optimization');
    });
  });

  // ===== COACHING SPECIFIC FEATURES =====
  describe('Coaching Features', () => {
    test('should handle multiple success metrics', () => {
      const propsWithMultipleMetrics = {
        ...mockCoachProps,
        successMetrics: ['AOV', 'Conversion Rate', 'Customer LTV', 'Retention']
      };
      
      renderWithTheme(<CoachTrigger {...propsWithMultipleMetrics} />);
      
      const metricsElement = screen.getByTestId('coach-success-metrics');
      expect(metricsElement).toHaveTextContent('AOV, Conversion Rate, Customer LTV, Retention');
    });

    test('should handle single success metric', () => {
      const propsWithSingleMetric = {
        ...mockCoachProps,
        successMetrics: ['AOV']
      };
      
      renderWithTheme(<CoachTrigger {...propsWithSingleMetric} />);
      
      const metricsElement = screen.getByTestId('coach-success-metrics');
      expect(metricsElement).toHaveTextContent('AOV');
    });

    test('should format estimated impact with proper styling', () => {
      renderWithTheme(<CoachTrigger {...mockCoachProps} />);
      
      const impactElement = screen.getByTestId('coach-impact');
      expect(impactElement).toHaveTextContent('+15% Revenue');
      // Should have positive impact styling
      expect(impactElement).toHaveClass('MuiChip-colorSuccess');
    });

    test('should handle negative impact styling', () => {
      const propsWithNegativeImpact = {
        ...mockCoachProps,
        estimatedImpact: '-5% Churn Rate'
      };
      
      renderWithTheme(<CoachTrigger {...propsWithNegativeImpact} />);
      
      const impactElement = screen.getByTestId('coach-impact');
      // Negative reduction should still be positive styling
      expect(impactElement).toHaveClass('MuiChip-colorSuccess');
    });
  });

  // ===== INHERITED BASE TRIGGER FEATURES =====
  describe('Inherited BaseTrigger Features', () => {
    test('should pass through feedback enabled prop', () => {
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          feedbackEnabled={true}
          onFeedback={mockFeedbackHandler}
        />
      );

      expect(screen.getByTestId('feedback-ui')).toBeInTheDocument();
    });

    test('should pass through confidence score', () => {
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          confidenceScore={0.92}
        />
      );

      const wrapper = screen.getByTestId('base-trigger-wrapper');
      expect(wrapper).toHaveAttribute('data-confidence-score', '0.92');
      expect(screen.getByTestId('confidence-indicator')).toHaveTextContent('92%');
    });

    test('should pass through reasoning', () => {
      const reasoning = ['Historical data analysis', 'Industry benchmarks'];
      
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          reasoning={reasoning}
        />
      );

      expect(screen.getByTestId('reasoning-list')).toBeInTheDocument();
      expect(screen.getByText(/Historical data analysis/)).toBeInTheDocument();
    });

    test('should pass through approval workflow', () => {
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          requiresApproval={true}
          approvalWorkflow="marketing-budget-approval"
        />
      );

      expect(screen.getByTestId('approval-indicator')).toBeInTheDocument();
      expect(screen.getByText('Workflow: marketing-budget-approval')).toBeInTheDocument();
    });
  });

  // ===== INTERACTION TESTS =====
  describe('User Interactions', () => {
    test('should handle feedback interactions', () => {
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          feedbackEnabled={true}
          onFeedback={mockFeedbackHandler}
        />
      );

      const helpfulButton = screen.getByTestId('feedback-helpful');
      fireEvent.click(helpfulButton);

      expect(mockFeedbackHandler).toHaveBeenCalledWith(
        'coach-insight-123',
        'accepted'
      );
    });

    test('should maintain focus management in coaching context', async () => {
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          feedbackEnabled={true}
        />
      );

      const notHelpfulButton = screen.getByTestId('feedback-not-helpful');
      fireEvent.click(notHelpfulButton);

      // Should maintain BaseTrigger focus behavior
      await screen.findByTestId('feedback-reason-not_relevant');
    });
  });

  // ===== ACCESSIBILITY TESTS =====
  describe('Accessibility', () => {
    test('should have proper ARIA labels for coaching content', () => {
      renderWithTheme(<CoachTrigger {...mockCoachProps} />);
      
      expect(screen.getByTestId('coach-tactic')).toHaveAttribute('aria-label', 'Recommended tactic: Exit Intent Popup');
      expect(screen.getByTestId('coach-success-metrics')).toHaveAttribute('aria-label', 'Success metrics: AOV, Conversion Rate');
      expect(screen.getByTestId('coach-impact')).toHaveAttribute('aria-label', 'Estimated impact: +15% Revenue');
    });

    test('should maintain BaseTrigger accessibility features', () => {
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          feedbackEnabled={true}
        />
      );

      expect(screen.getByRole('group', { name: 'Provide feedback on this insight' })).toBeInTheDocument();
    });
  });

  // ===== EDGE CASES =====
  describe('Edge Cases', () => {
    test('should handle empty success metrics array', () => {
      const propsWithEmptyMetrics = {
        ...mockCoachProps,
        successMetrics: []
      };

      expect(() => {
        renderWithTheme(<CoachTrigger {...propsWithEmptyMetrics} />);
      }).not.toThrow();

      expect(screen.getByTestId('coach-success-metrics')).toHaveTextContent('');
    });

    test('should handle very long tactic names', () => {
      const longTactic = 'Implement Advanced Customer Segmentation with Predictive Analytics and Machine Learning Models';
      
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          tactic={longTactic}
        />
      );

      expect(screen.getByTestId('coach-tactic')).toHaveTextContent(longTactic);
    });

    test('should handle complex estimated impact formats', () => {
      const complexImpact = '$5,000 - $7,500 monthly revenue increase with 15-20% margin improvement';
      
      renderWithTheme(
        <CoachTrigger 
          {...mockCoachProps} 
          estimatedImpact={complexImpact}
        />
      );

      expect(screen.getByTestId('coach-impact')).toHaveTextContent(complexImpact);
    });
  });
});
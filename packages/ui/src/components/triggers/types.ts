// packages/ui/src/components/triggers/types.ts

// --- Blueprint 4.4: Closed Loop Feedback ---
export type FeedbackAction = 'accepted' | 'dismissed' | 'ignored';
export type FeedbackReason = 'not_relevant' | 'incorrect' | 'already_done';

export interface InsightFeedback {
  reason: FeedbackReason;
  context: string;
}

export type FeedbackHandler = (
  insightId: string,
  action: FeedbackAction,
  feedback?: InsightFeedback,
) => void;

// --- Blueprint 5.1: Base Trigger ---
export type TriggerType = 'coach' | 'action' | 'automation' | 'orchestration';

export interface BaseTriggerProps {
  /**
   * Unique ID for the insight this trigger is attached to.
   * Used for all feedback and telemetry.
   */
  insightId: string;
  /**
   * The category of action this trigger performs.
   */
  triggerType: TriggerType;
  /**
   * Enables or disables the feedback UI (e.g., "Was this helpful?").
   */
  feedbackEnabled?: boolean;
  /**
   * Callback function fired when a user interacts with the feedback UI.
   */
  onFeedback?: FeedbackHandler;
  /**
   * If true, this trigger requires an approval workflow to execute.
   * (Governance Layer L4)
   */
  requiresApproval?: boolean;
  /**
   * The name of the approval workflow to initiate.
   * (Governance Layer L4)
   */
  approvalWorkflow?: string;
  /**
   * The AI's confidence in this insight (0.0 - 1.0).
   * (Governance Layer L4)
   */
  confidenceScore?: number;
  /**
   * An array of strings explaining the confidenceScore.
   * (Governance Layer L4)
   */
  reasoning?: string[];
  /**
   * The component's children.
   */
  children: React.ReactNode;
}
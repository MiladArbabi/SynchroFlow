/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/triggers/BaseTrigger.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Box, Button, Stack, Typography, Chip, Collapse, IconButton } from '@mui/material';
import { ThumbUp, ThumbDown, ExpandMore, ExpandLess } from '@mui/icons-material';
import { BaseTriggerProps, FeedbackAction, FeedbackReason } from './types';

/**
 * The foundational ACI Trigger component.
 *
 * This component acts as a wrapper that injects ACI context
 * (like insightId and triggerType) into the DOM for telemetry
 * and provides hooks for feedback and governance.
 *
 * It is not meant to be used directly, but as the base for
 * specialized triggers like CoachTrigger, AutomationTrigger, etc.
 */
export const BaseTrigger: React.FC<BaseTriggerProps> = ({
  children,
  insightId,
  triggerType,
  confidenceScore,
  reasoning = [],
  requiresApproval = false,
  approvalWorkflow,
  feedbackEnabled = false,
  onFeedback,
}) => {
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState<FeedbackAction | null>(null);
  const [selectedReason, setSelectedReason] = useState<FeedbackReason | null>(null);
  
  // Refs for focus management
  const firstReasonRef = useRef<HTMLButtonElement>(null);
  const notHelpfulButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management when feedback expands
  useEffect(() => {
    if (feedbackExpanded && firstReasonRef.current) {
      // Small timeout to ensure the collapse animation is complete
      setTimeout(() => {
        firstReasonRef.current?.focus();
      }, 100);
    }
  }, [feedbackExpanded]);

  const handleFeedbackClick = (action: 'accepted' | 'dismissed') => {
    setFeedbackAction(action);
    
    if (action === 'accepted') {
      // Immediate feedback for positive action
      onFeedback?.(insightId, action);
      setFeedbackExpanded(false);
    } else {
      // Show reason selection for negative feedback
      setFeedbackExpanded(true);
    }
  };

  const handleReasonSubmit = () => {
    if (feedbackAction && selectedReason) {
      onFeedback?.(insightId, feedbackAction, {
        reason: selectedReason,
        context: '' // Could be enhanced with user input
      });
      setFeedbackExpanded(false);
      setFeedbackAction(null);
      setSelectedReason(null);
      
      // Return focus to the not helpful button
      setTimeout(() => {
        notHelpfulButtonRef.current?.focus();
      }, 100);
    }
  };

  const handleCancelFeedback = () => {
    setFeedbackExpanded(false);
    setFeedbackAction(null);
    setSelectedReason(null);
    
    // Return focus to the not helpful button
    setTimeout(() => {
      notHelpfulButtonRef.current?.focus();
    }, 100);
  };

  return (
    <Box
      data-testid="base-trigger-wrapper"
      data-insight-id={insightId}
      data-trigger-type={triggerType}
      data-confidence-score={confidenceScore ?? ''}
      data-requires-approval={requiresApproval.toString()}
      data-approval-workflow={approvalWorkflow ?? ''}
      sx={{
        position: 'relative',
        border: requiresApproval ? '2px dashed #ffa726' : 'none',
        borderRadius: 1,
        p: requiresApproval ? 1 : 0,
      }}
    >
      {/* Governance Indicators */}
      {requiresApproval && (
        <Box sx={{ mb: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip 
            label="Approval Required" 
            size="small" 
            color="warning" 
            variant="outlined"
            data-testid="approval-indicator"
          />
          {approvalWorkflow && (
            <Typography variant="caption" color="text.secondary">
              Workflow: {approvalWorkflow}
            </Typography>
          )}
        </Box>
      )}

      {confidenceScore !== undefined && (
        <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip 
            label={`Confidence: ${Math.round(confidenceScore * 100)}%`}
            size="small"
            color={
              confidenceScore > 0.8 ? 'success' :
              confidenceScore > 0.6 ? 'warning' : 'error'
            }
            variant="outlined"
            data-testid="confidence-indicator"
          />
        </Box>
      )}

      {/* Reasoning Display */}
      {reasoning.length > 0 && (
        <Box 
          data-testid="reasoning-list"
          sx={{ mb: 2, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}
        >
          <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>
            Reasoning:
          </Typography>
          <Stack spacing={0.5}>
            {reasoning.map((reason, index) => (
              <Typography key={index} variant="caption" display="block">
                • {reason}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {/* Main Content */}
      {children}

      {/* Feedback UI */}
      {feedbackEnabled && (
        <Box 
          data-testid="feedback-ui"
          sx={{ 
            mt: 2, 
            pt: 2, 
            borderTop: '1px solid', 
            borderColor: 'divider',
          }}
          role="group"
          aria-label="Provide feedback on this insight"
        >
          {!feedbackExpanded ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Was this helpful?
              </Typography>
              <IconButton
                size="small"
                data-testid="feedback-helpful"
                onClick={() => handleFeedbackClick('accepted')}
                aria-label="This was helpful"
              >
                <ThumbUp fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                data-testid="feedback-not-helpful"
                onClick={() => handleFeedbackClick('dismissed')}
                aria-label="This was not helpful"
                ref={notHelpfulButtonRef}
              >
                <ThumbDown fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <Collapse in={feedbackExpanded}>
              <Box data-testid="feedback-reasons">
                <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>
                  Why wasn't this helpful?
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                  {(['not_relevant', 'incorrect', 'already_done'] as FeedbackReason[]).map((reason, index) => (
                    <Button
                      key={reason}
                      size="small"
                      variant={selectedReason === reason ? "contained" : "outlined"}
                      onClick={() => setSelectedReason(reason)}
                      data-testid={`feedback-reason-${reason}`}
                      ref={index === 0 ? firstReasonRef : undefined} // Focus first reason
                    >
                      {reason.replace('_', ' ')}
                    </Button>
                  ))}
                </Stack>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!selectedReason}
                    onClick={handleReasonSubmit}
                    data-testid="feedback-submit"
                  >
                    Submit Feedback
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleCancelFeedback}
                    data-testid="feedback-cancel"
                  >
                    Cancel
                  </Button>
                </Box>
              </Box>
            </Collapse>
          )}
        </Box>
      )}
    </Box>
  );
};
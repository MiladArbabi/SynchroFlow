/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from 'contexts/ToastContext';
import { OpsActionType, useOpsContext } from 'contexts/OpsContext'; // Import Action Type
import { OpsAction, CommandResult } from 'components/OpsCommandCenter/types';
import { Intent } from 'components/OpsCommandCenter/naturalLanguage/types'; // Import Intent

/**
 * A hook to safely execute Kore OpsActions.
 * This handles loading state, permissions, and success/error feedback.
 */
export const useCommandExecution = () => {
  const [isExecuting, setIsExecuting] = useState(false);
  const { show: showToast } = useToast();
  const { context, dispatch } = useOpsContext(); // Get dispatch
  const navigate = useNavigate();

  const executeCommand = async (
    action: OpsAction,
    intent: Intent | null, // Use the correct type
  ): Promise<CommandResult> => {
    setIsExecuting(true);

    try {
      // 1. Check Permissions
      if (action.context.requiredPermissions) {
        const hasPermission = action.context.requiredPermissions.every((perm) =>
          context.userPermissions.includes(perm),
        );
        
        if (!hasPermission) {
          throw new Error('Insufficient permissions');
        }
      }

      // 2. Execute the Action
      const result = await action.execute(context, navigate);

      // 3. Show Success Feedback
      showToast(result.message, 'success');
      setIsExecuting(false);

      // 4. SAVE TO CONVERSATION MEMORY (NEW)
      // If this was a high-confidence NLP action (not null and not 'search')
      if (intent && intent.name !== 'search' && intent.confidence > 0.4) {
        dispatch({
          type: OpsActionType.SET_CONVERSATION,
          payload: {
            topic: intent.name,
            entities: intent.entities,
            timestamp: Date.now(),
          },
        });
      }

      return result;

    } catch (error: any) {
      // 5. Show Error Feedback
      const errorMessage = error.message || 'An unknown error occurred';
      showToast(errorMessage, 'error');
      setIsExecuting(false);
      throw error; // Re-throw for the component to handle if needed
    }
  };

  return { executeCommand, isExecuting };
};
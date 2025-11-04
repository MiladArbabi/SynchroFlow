/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from 'contexts/ToastContext';
import { useOpsContext } from 'contexts/OpsContext';
import { OpsAction, CommandResult } from 'components/OpsCommandCenter/types';
// import { Intent } from 'components/OpsCommandCenter/naturalLanguage/types'; // <-- 1. COMMENT OUT

/**
 * A hook to safely execute Kore OpsActions.
 * This handles loading state, permissions, and success/error feedback.
 */
export const useCommandExecution = () => {
  const [isExecuting, setIsExecuting] = useState(false);
  const { show: showToast } = useToast();
  const { context } = useOpsContext();
  const navigate = useNavigate();

  const executeCommand = async (
    action: OpsAction,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    intent: any, // <-- 2. SET TO 'any' FOR NOW (was Intent | null)
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
      return result;

    } catch (error: any) {
      // 4. Show Error Feedback
      const errorMessage = error.message || 'An unknown error occurred';
      showToast(errorMessage, 'error');
      setIsExecuting(false);
      throw error; // Re-throw for the component to handle if needed
    }
  };

  return { executeCommand, isExecuting };
};
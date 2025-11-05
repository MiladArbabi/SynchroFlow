/* eslint-disable @typescript-eslint/no-unused-vars */
//packages/ui/src/components/OpsCommandCenter/index.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { OpsAction } from './types';
import { useOpsContext } from 'contexts/OpsContext';
import useConfig from 'hooks/useConfig'; // We need this to read the open state

// Import all our new hooks and components
import { useOpsCommands } from './hooks/useOpsCommands';
import { useCommandExecution } from './hooks/useCommandExecution';
import { OpsCommandInput } from './OpsCommandInput';
import { OpsResultsList } from './OpsResultsList';
import { ConfirmationDialog } from './ConfirmationDialog';

// --- L2 IMPORTS ---
import { ClarificationOption, Intent } from './naturalLanguage/types';
import { parseIntent } from './naturalLanguage/intentParser';
import { executeNaturalLanguage } from './naturalLanguage/queryExecutor';
import { InterpretationBanner } from './InterpretationBanner';
import { OpsClarificationList } from './OpsClarificationList';

// --- Define the Interpretation state type ---
interface Interpretation {
  originalQuery: string;
  interpretedAction: OpsAction | null;
  intent: Intent;
  confidence: number;
}

/**
 * Kore v1.0: OpsCommandCenter
 *
 * This is the main container for the entire Kore co-pilot UI.
 * It connects all the Layer 1 hooks and components.
 */

export const OpsCommandCenter = () => {
  // --- L1 STATE ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmingAction, setConfirmingAction] = useState<OpsAction | null>(
    null,
  );
  // --- L2 STATE ---
  const [interpretation, setInterpretation] = useState<Interpretation | null>(
    null,
  );

  // --- L2.75 STATE (NEW) ---
  const [clarificationOptions, setClarificationOptions] = useState<
    ClarificationOption[] | null
  >(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // --- HOOKS ---
  const { state: configState } = useConfig();
  const { context } = useOpsContext();
  const { executeCommand, isExecuting } = useCommandExecution();

  // --- L1 HOOK (LOW-CONFIDENCE FALLBACK) ---
  // This hook now only runs its search logic when there's no interpretation
  // 3. Don't run search if we are interpreting OR clarifying
  const commands = useOpsCommands(
    interpretation || clarificationOptions ? '' : searchQuery,
  );

  // --- L2 "BRAIN" ---
  // This effect runs on every keystroke to check for a L2 intent
  useEffect(() => {
    // Don't parse empty queries
    if (searchQuery.trim().length < 3) {
      setInterpretation(null); // Clear any previous interpretation
      setClarificationOptions(null); // Clear clarifications
      return;
    }

    // Call the NLP parser
    // (We pass 'null' for conversation context for now)
    const intent = parseIntent(searchQuery, null);

    // --- 4. UPDATE ROUTER LOGIC ---
    if (intent.name === 'clarify' && intent.clarificationOptions) {
      // MEDIUM CONFIDENCE: Show clarification list
      setInterpretation(null);
      setClarificationOptions(intent.clarificationOptions);
    } else if (intent.confidence > 0.45) {
      // We have a high-confidence match.
      // Build the dynamic action (e.g., "Find orders with status...")
      const interpretedAction = executeNaturalLanguage(intent);
      setInterpretation({
        originalQuery: searchQuery,
        interpretedAction,
        intent,
        confidence: intent.confidence,
      });
      setClarificationOptions(null);
    } else {
      // Low confidence. Fall back to L1 search.
      setInterpretation(null);
      setClarificationOptions(null);
    }
  }, [searchQuery]);

  // --- KEYBOARD NAVIGATION & EXECUTION ---
  const handleKeyDown = (event: React.KeyboardEvent) => {
    // If L2 Banner is showing, "Enter" executes that
    if (interpretation && interpretation.interpretedAction) {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleExecute(interpretation.interpretedAction);
        }
        return; // Disable ArrowUp/Down when banner is showing
      }

      // If Clarification is showing, disable keyboard nav
      if (clarificationOptions) {
        return;
      }

    // L1 List Navigation
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % commands.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + commands.length) % commands.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (commands[selectedIndex]) {
        handleExecute(commands[selectedIndex]);
      }
    }
  };

  // --- ACTION EXECUTION HANDLER ---
  const handleExecute = (action: OpsAction) => {
    if (action.category === 'destructive' && action.confirmationMessage) {
      setConfirmingAction(action);
    } else {
      executeCommand(action, interpretation ? interpretation.intent : null);
    }
  };

  // --- CONFIRMATION DIALOG HANDLERS ---
  const onConfirmExecute = () => {
    if (confirmingAction) {
      executeCommand(
        confirmingAction,
        interpretation ? interpretation.intent : null,
      );
      setConfirmingAction(null);
    }
  };

  const onCancelConfirm = () => {
    setConfirmingAction(null);
    inputRef.current?.focus();
  };

  // --- L2 BANNER CANCEL HANDLER ---
  const onCancelInterpretation = () => {
    setInterpretation(null); // Fall back to L1 search list
    inputRef.current?.focus();
  };

  // --- L2.75 CLARIFICATION HANDLER (NEW) ---
  const onClarificationSelect = (option: ClarificationOption) => {
    // User answered the question.
    // 1. Set the new interpretation
    setInterpretation({
      originalQuery: option.label,
      interpretedAction: executeNaturalLanguage(option.intent),
      intent: option.intent,
      confidence: option.intent.confidence,
    });
    // 2. Clear the questions
    setClarificationOptions(null);
  };

  // Reset selection when search query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Reset search query after successful execution
  useEffect(() => {
    if (!isExecuting) {
      setSearchQuery('');
      inputRef.current?.focus();
    }
  }, [isExecuting]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <OpsCommandInput
        ref={inputRef}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onKeyDown={handleKeyDown}
        isExecuting={isExecuting}
        isConsoleOpen={configState.isOpsConsoleOpen}
      />

      {isExecuting ? (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexGrow: 1,
            p: 2,
          }}
        >
          <CircularProgress size={24} />
        </Box>
      ) : // --- THE CONFIDENCE SPECTRUM ROUTER ---
      interpretation && interpretation.interpretedAction ? (
        // L2: High Confidence - Show the Banner
        <InterpretationBanner
          interpretation={interpretation}
          onExecute={() => handleExecute(interpretation.interpretedAction!)}
          onCancel={onCancelInterpretation}
        />
      ) : clarificationOptions ? (
        // L2.75: Medium Confidence - Show the Clarification List
        <OpsClarificationList
          options={clarificationOptions}
          onSelect={onClarificationSelect}
        />
      ) : (
        // L1: Low Confidence - Show the Search List
        <OpsResultsList
          commands={commands}
          selectedIndex={selectedIndex}
          onCommandSelect={handleExecute}
        />
      )}
      {/* --- END ROUTER --- */}

      <ConfirmationDialog
        isOpen={!!confirmingAction}
        action={confirmingAction}
        onConfirm={onConfirmExecute}
        onCancel={onCancelConfirm}
      />
    </Box>
  );
};
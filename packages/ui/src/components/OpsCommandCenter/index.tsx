/* eslint-disable @typescript-eslint/no-unused-vars */
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

/**
 * Kore v1.0: OpsCommandCenter
 *
 * This is the main container for the entire Kore co-pilot UI.
 * It connects all the Layer 1 hooks and components.
 */
export const OpsCommandCenter = () => {
  // --- STATE ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Confirmation dialog state
  const [confirmingAction, setConfirmingAction] = useState<OpsAction | null>(
    null,
  );

  const inputRef = useRef<HTMLInputElement>(null);

  // --- HOOKS ---
  const { state: configState } = useConfig();
  const { context } = useOpsContext();
  const { executeCommand, isExecuting } = useCommandExecution();

  // The "brain" - gets the list of commands based on context and search query
  const commands = useOpsCommands(searchQuery);

  // --- KEYBOARD NAVIGATION & EXECUTION ---
  const handleKeyDown = (event: React.KeyboardEvent) => {
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
    // Check if the action is 'destructive'
    if (action.category === 'destructive' && action.confirmationMessage) {
      // Open the confirmation dialog
      setConfirmingAction(action);
    } else {
      // Execute "safe" or "analytical" actions immediately
      executeCommand(action, null);
    }
  };

  // --- CONFIRMATION DIALOG HANDLERS ---
  const onConfirmExecute = () => {
    if (confirmingAction) {
      executeCommand(confirmingAction, null);
      setConfirmingAction(null); // Close dialog
    }
  };

  const onCancelConfirm = () => {
    setConfirmingAction(null); // Close dialog
    inputRef.current?.focus(); // Refocus input
  };

  // --- EFFECTS ---
  // Reset selection when search query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Reset search query after successful execution (for rapid-fire)
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
      ) : (
        <OpsResultsList
          commands={commands}
          selectedIndex={selectedIndex}
          onCommandSelect={handleExecute}
        />
      )}

      <ConfirmationDialog
        isOpen={!!confirmingAction}
        action={confirmingAction}
        onConfirm={onConfirmExecute}
        onCancel={onCancelConfirm}
      />
    </Box>
  );
};
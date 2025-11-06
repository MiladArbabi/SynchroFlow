/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
//packages/ui/src/components/OpsCommandCenter/index.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query'; 
import axios from 'axios'; 
import { OpsAction, SearchResult, VirtualItem } from './types';
import { useHealthContext } from 'contexts/HealthContext';
import { OpsActionType, useOpsContext } from 'contexts/OpsContext';
import useConfig from 'hooks/useConfig'; // We need this to read the open state

// Import all our new hooks and components
import { useOpsCommands } from './hooks/useOpsCommands';
import { useCommandExecution } from './hooks/useCommandExecution';
import { useKoreRanking } from './hooks/useKoreRanking';
import { useSemanticQuery } from './hooks/useSemanticQuery';
import { useDebounce } from 'hooks/useDebounce';
import { OpsCommandInput } from './OpsCommandInput';
import { OpsResultsList } from './OpsResultsList';
import { ConfirmationDialog } from './ConfirmationDialog';

// --- L2 IMPORTS ---
import { ClarificationOption, Intent } from './naturalLanguage/types';
import { parseIntent } from './naturalLanguage/intentParser';
import { executeNaturalLanguage } from './naturalLanguage/queryExecutor';
import { InterpretationBanner } from './InterpretationBanner';
import { OpsClarificationList } from './OpsClarificationList';
import { OpsProactiveList } from './OpsProactiveList';

// --- Define the Interpretation state type ---
interface Interpretation {
  originalQuery: string;
  interpretedAction: OpsAction | null;
  intent: Intent;
  confidence: number;
}

/**
 * Kore v1.0: OpsCommandCenter
 * This is the main container for the entire Kore co-pilot UI.
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
  const { context, dispatch } = useOpsContext();
  const { isKoreHealthy } = useHealthContext();
  const { executeCommand, isExecuting } = useCommandExecution();

  // --- DEBOUNCE THE SEARCH QUERY ---
  const debouncedSearchQuery = useDebounce(searchQuery, 150);

  // --- EXPAND THE QUERY WITH SYNONYMS ---
  const semanticQuery = useSemanticQuery(debouncedSearchQuery);

  // --- L1 HOOK (LOW-CONFIDENCE FALLBACK) ---
  // This hook now only runs its search logic when there's no interpretation
  // 3. Don't run search if we are interpreting OR clarifying
  const commands = useOpsCommands(
    interpretation || clarificationOptions ? '' : semanticQuery,
  );

  // --- L2 FEDERATED SEARCH (NEW) ---
  // This hook calls our /api/v1/kore/search endpoint
  const { data: entities = [] } = useQuery<SearchResult[]>({
    queryKey: ['kore-federated-search', semanticQuery],
    queryFn: async () => {
      // Only run if the query is valid and L2 is healthy
      if (semanticQuery.trim().length < 2 || !isKoreHealthy) {
        return [];
      }

      const { data } = await axios.get(
        `/api/v1/kore/search?q=${semanticQuery.toLowerCase()}`,
      );
      
      return data;
    },
    // We don't want this to refetch constantly
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // ---  RANK THE COMBINED RESULTS ---
  const combinedResults = useKoreRanking(commands, entities, context);

  // --- FLATTEN RESULTS FOR VIRTUALIZER (LIFTED FROM OpsResultsList) ---
  // This array now drives navigation and rendering
  const items: VirtualItem[] = useMemo(() => {
    const newItems: VirtualItem[] = [];
    if (commands.length > 0) {
      newItems.push({ type: 'header', label: 'Actions' });
      newItems.push(
        ...commands.map((cmd): VirtualItem => ({ type: 'item', data: cmd })),
      );
    }
    if (entities.length > 0) {
      newItems.push({ type: 'header', label: 'Entities' });
      newItems.push(
        ...entities.map((ent): VirtualItem => ({ type: 'item', data: ent })),
      );
    }
    return newItems;
  }, [commands, entities]);

  // --- L2 "BRAIN" ---
  // This effect runs on every keystroke to check for a L2 intent
  useEffect(() => {
    //  --- DEGRADATION CHECK ---
    // If the API is unhealthy, do NOT attempt to run L2 NLP.
    if (!isKoreHealthy) {
      return;
    }

    // Don't parse empty queries
    if (semanticQuery.trim().length < 3) {
      setInterpretation(null); // Clear any previous interpretation
      setClarificationOptions(null); // Clear clarifications
      return;
    }

    // Call the NLP parser
    // (We pass 'null' for conversation context for now)
    const intent = parseIntent(semanticQuery, null);

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
  }, [semanticQuery, isKoreHealthy]);

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

    // --- NEW "SMART" NAVIGATION LOGIC ---
    const findNextSelectable = (startIndex: number, direction: 'down' | 'up') => {
      if (items.length === 0) return 0;

      let newIndex = startIndex;
      const step = direction === 'down' ? 1 : -1;

      // Move at least once
      do {
        newIndex = (newIndex + step + items.length) % items.length;
        // Keep moving if the new index is a header and we haven't looped
      } while (items[newIndex].type === 'header' && newIndex !== startIndex);
      
      // If we looped all the way and are *still* on a header (e.g., a list with only headers)
      if (newIndex === startIndex && items[newIndex].type === 'header') return startIndex;

      return newIndex;
    };

    // L1 List Navigation
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => findNextSelectable(prev, 'down'));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => findNextSelectable(prev, 'up'));
    } else if (event.key === 'Enter') {
      event.preventDefault();
    }

    // Get the selected item from the *new* items array
      const selectedItem = items[selectedIndex];

      // Only execute if it's an 'item'
      if (selectedItem && selectedItem.type === 'item') {
        handleItemSelect(selectedItem.data);
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

  // --- IMPLEMENT handleItemSelect ---
  const handleItemSelect = (item: OpsAction | SearchResult) => {
    // Check if it's an OpsAction (it has 'keywords')
    if ('keywords' in item) {
      handleExecute(item);
    } else {
      // It's a SearchResult (entity).
      // We use 'window.location' for now.
      // In a future ticket, we'll replace this with client-side routing
      // by passing 'navigate' from 'useNavigate' into this function.
      window.location.href = item.url;
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
    // Set to first *selectable* item (index 1), or 0 if list is empty
    setSelectedIndex(items.length > 0 ? 1 : 0);
  }, [semanticQuery]); // Rerun when query changes

  // Reset search query after successful execution
  useEffect(() => {
    if (!isExecuting) {
      setSearchQuery('');
      inputRef.current?.focus();
    }
  }, [isExecuting]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 5. --- RENDER DEGRADATION WARNING --- */}
      {!isKoreHealthy && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          Kore is in degraded mode. Search is limited.
        </Alert>
      )}
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
      ) : !searchQuery && context.proactiveInsights.filter(i => i.status === 'new').length > 0 ? (
        // L3: Idle + Proactive Insights - Show the Proactive List
        <OpsProactiveList
          insights={context.proactiveInsights}
          onActionClick={(_insight, action) => handleItemSelect(action.action)}
          // 2. Use the enum, not the string
          onDismiss={(insightId) =>
            dispatch({ type: OpsActionType.UPDATE_INSIGHT_STATUS, payload: { id: insightId, status: 'dismissed' } })
          }
        />
      ) : searchQuery.length > 0 ? (
        <OpsResultsList
          items={items} // Pass the new items array
          selectedIndex={selectedIndex}
          onCommandSelect={handleItemSelect}
        />
        ) : (
        // L0: Idle + Clean - Show nothing (or a "welcome" message later)
        <Box sx={{ flexGrow: 1 }} /> // Render an empty box
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
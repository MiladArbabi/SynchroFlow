import { useMemo } from 'react';
import { useOpsContext } from 'contexts/OpsContext';
import { ALL_ACTIONS } from 'components/OpsCommandCenter/commandDefinitions';
import { OpsAction } from 'components/OpsCommandCenter/types';
import { useNativeSearch } from './useNativeSearch';

// Define the keys we want our search hook to look at.
const SEARCH_KEYS: ('name' | 'keywords' | 'description')[] = ['name', 'keywords', 'description'];
/**
 * The "brain" of Layer 1.
 * This hook filters all available commands based on the current application
 * context and the user's search query.
 *
 * @param searchQuery The raw text query from the user.
 */
export const useOpsCommands = (searchQuery: string): OpsAction[] => {
  const { context } = useOpsContext();

  // Step 1: Filter by Context
  // This memoized list narrows down actions based on the user's *location* in the app.
  const contextFilteredActions = useMemo(() => {
    return ALL_ACTIONS.filter((action) => {
      const { pages, needsEntity } = action.context;

      // Check if action is global (available on all pages)
      if (pages.includes('*')) {
        return true;
      }

      // Check if action matches the current page
      const pageMatch = pages.includes(context.page);

      // If the page matches, we then check entity requirements
      if (pageMatch) {
        // If the action *requires* a selected entity (like 'refund-order')...
        if (needsEntity) {
          // ...we only include it if an entityId is actually set in the context.
          return !!context.entityId;
        }
        // Action doesn't need an entity, just the page match.
        return true;
      }

      // No match
      return false;
    });
  }, [context.page, context.entityId]); // Only re-filter when context changes

  // Step 2: Filter by Search Query
  // We pass the already context-aware list to our native search hook.
  const searchFilteredActions = useNativeSearch(
    contextFilteredActions,
    searchQuery,
    SEARCH_KEYS,
  );

  return searchFilteredActions;
};
//packages/ui/src/components/OpsCommandCenter/hooks/useKoreRanking.ts
import { useMemo } from 'react';
import { OpsContextState } from 'contexts/OpsContext';
import { OpsAction, SearchResult } from 'components/OpsCommandCenter/types';

type SearchItem = OpsAction | SearchResult;

// Define boost scores
const PAGE_CONTEXT_BOOST = 1.5;
const PERMISSION_BOOST = 1.3;
const ACTION_TYPE_BOOST = 0.01;

// Helper to determine the item's type
const getItemType = (item: SearchItem): 'action' | 'entity' => {
  return 'keywords' in item ? 'action' : 'entity';
};

/**
 * A hook that takes the combined search results and re-ranks them
 * based on the user's current context (e.g., current page).
 */
export const useKoreRanking = (
  actions: OpsAction[],
  entities: SearchResult[],
  context: OpsContextState,
): SearchItem[] => {
  return useMemo(() => {
    const combinedItems = [...actions, ...entities];

    const rankedItems = combinedItems.map((item) => {
      let score = 1.0; // Default score

      // --- Type "Tie-breaker" Boost ---
      if (getItemType(item) === 'action') {
        score += ACTION_TYPE_BOOST; 
      }

      // --- 1. Context-Aware Page Boosting ---
      if (getItemType(item) === 'action') {
        const action = item as OpsAction;
        if (action.context.pages.includes(context.page)) {
          score *= PAGE_CONTEXT_BOOST;
        }
      } else {
        const entity = item as SearchResult;
        // 'order' entities get a boost on the 'orders' page
        if (entity.type === 'order' && context.page === 'orders') {
          score *= PAGE_CONTEXT_BOOST;
        }
        // 'customer' entities get a boost on the 'customers' page
        if (entity.type === 'customer' && context.page === 'customers') {
          score *= PAGE_CONTEXT_BOOST;
        }
      }

      // --- 2. Permission Boosting ---
      // Boost actions the user actually has permission for
      if (getItemType(item) === 'action') {
        const action = item as OpsAction;
        if (action.context.requiredPermissions) {
          const hasPermission = action.context.requiredPermissions.every(
            (perm) => context.userPermissions.includes(perm),
          );
          if (hasPermission) {
            score *= PERMISSION_BOOST;
          }
        }
      }

      return { item, score };
    });

    // Sort by score (descending) and return just the items
    return rankedItems
      .sort((a, b) => b.score - a.score)
      .map((ranked) => ranked.item);
  }, [actions, entities, context]);
};
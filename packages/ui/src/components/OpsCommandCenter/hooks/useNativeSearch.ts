/* eslint-disable @typescript-eslint/no-explicit-any */
//packages/ui/src/components/OpsCommandCenter/hooks/useNativeSearch.ts
import { useMemo } from 'react';

// Define weights for ranking. Higher is better.
const RANKING_WEIGHTS = {
  name: 10,
  keywords: 5,
  description: 1,
};

type SearchableItem = {
  [key: string]: any;
};

/**
 * Creates a single, lowercase string from an item's searchable fields.
 * This is pre-calculated once per item for performance.
 */
const createSearchableString = (
  item: SearchableItem,
  keys: (keyof typeof RANKING_WEIGHTS)[],
): string => {
  return keys
    .map((key) => {
      const value = item[key];
      if (Array.isArray(value)) {
        return value.join(' ');
      }
      return value;
    })
    .join(' ')
    .toLowerCase();
};

/**
 * Calculates a score for an item based on the query terms.
 * Higher score is better.
 */
const calculateScore = (
  item: SearchableItem,
  terms: string[],
  keys: (keyof typeof RANKING_WEIGHTS)[],
): number => {
  let score = 0;

  for (const key of keys) {
    const value = String(item[key] || '').toLowerCase();
    const weight = RANKING_WEIGHTS[key] || 1;

    for (const term of terms) {
      if (value.includes(term)) {
        // Higher score for "starts with"
        if (value.startsWith(term)) {
          score += weight * 2;
        } else {
          score += weight;
        }
      }
    }
  }
  return score;
};

/**
 * A native, dependency-free search hook that filters and ranks a list.
 *
 * @param items The array of items to search.
 * @param query The user's search query.
 * @param keys The keys within each item to search against (e.g., 'name', 'keywords').
 */
export const useNativeSearch = <T extends SearchableItem>(
  items: T[],
  query: string,
  keys: (keyof typeof RANKING_WEIGHTS)[],
): T[] => {
  // Memoize the processed items (searchable string)
  const processedItems = useMemo(() => {
    return items.map((item) => ({
      ...item,
      // Pre-calculate a single string to search against for filtering
      _searchableString: createSearchableString(item, keys),
    }));
  }, [items, keys]);

  return useMemo(() => {
    if (!query) {
      return items; // Return all items if query is empty
    }

    const terms = query.toLowerCase().split(' ').filter(Boolean);
    if (terms.length === 0) {
      return items;
    }

    const filtered = processedItems.filter((item) => {
      // AND logic: item must include *all* search terms
      return terms.every((term) => item._searchableString.includes(term));
    });

    // Rank the filtered results
    const ranked = filtered.map((item) => ({
      item,
      score: calculateScore(item, terms, keys),
    }));

    // Sort by score, descending
    return ranked.sort((a, b) => b.score - a.score).map((ranked) => ranked.item);
  }, [processedItems, query, keys, items]);
};
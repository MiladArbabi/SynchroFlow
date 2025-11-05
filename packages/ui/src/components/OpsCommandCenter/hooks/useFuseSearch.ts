//packages/ui/src/components/OpsCommandCenter/hooks/useFuseSearch.ts
import { useMemo } from 'react';
import Fuse from 'fuse.js';

// Configuration for Fuse.js
const fuseOptions = {
  // We're enabling fuzzy search
  isCaseSensitive: false,
  // We want to search on the keys provided
  keys: [],
  // A threshold of 0.3 is good for matching typos but not too loose
  threshold: 0.3,
  // Include the score so we can see relevance
  includeScore: true,
};

/**
 * A hook that performs a fuzzy search on a list of items using Fuse.js.
 *
 * @param items The array of items to search.
 * @param query The user's search query.
 * @param keys The keys within each item to search against (e.g., ['name', 'keywords']).
 */
export const useFuseSearch = <T>(
  items: T[],
  query: string,
  keys: string[],
): T[] => {
  // Memoize the Fuse instance for performance
  const fuse = useMemo(() => {
    return new Fuse(items, { ...fuseOptions, keys });
  }, [items, keys]);

  return useMemo(() => {
    if (!query) {
      return items; // Return all items if query is empty
    }

    // Run the search
    const results = fuse.search(query);

    // Return just the original items, sorted by relevance
    return results.map((result) => result.item);
  }, [fuse, query, items]);
};
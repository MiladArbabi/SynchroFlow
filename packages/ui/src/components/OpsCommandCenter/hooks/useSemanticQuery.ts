//packages/ui/src/components/OpsCommandCenter/hooks/useSemanticQuery.ts
import { useMemo } from 'react';
import { SYNONYM_MAP } from 'components/OpsCommandCenter/naturalLanguage/synonyms';

/**
 * Expands a search query to include synonyms for fuzzy searching.
 *
 * @example
 * 'return' -> 'return refund' (fuse.js treats this as OR)
 * 'find customer' -> 'view customer'
 *
 * @param query The user's raw search query
 * @returns An expanded query string for use with fuse.js
 */
export const useSemanticQuery = (query: string): string => {
  return useMemo(() => {
    const lowerQuery = query.toLowerCase();
    if (!lowerQuery) return '';

    const terms = lowerQuery.split(' ').filter(Boolean);
    let queryChanged = false;

    // 1. Expand each term
    const expandedTerms = terms.map((term) => {
      const synonym = SYNONYM_MAP[term];
      if (synonym && synonym !== term) {
        queryChanged = true;
        // Return both the original and the synonym
        return `${term} ${synonym}`;
      }
      return term;
    });

    // 2. Check for multi-word phrases (e.g., "find customer")
    let finalQuery = expandedTerms.join(' ');
    const fullQuerySynonym = SYNONYM_MAP[lowerQuery];
    if (fullQuerySynonym) {
      queryChanged = true;
      finalQuery = `${finalQuery} ${fullQuerySynonym}`;
    }

    // Only return a new string object if it actually changed
    return queryChanged ? finalQuery : lowerQuery;
  }, [query]); // <-- This dependency *was* correct
};
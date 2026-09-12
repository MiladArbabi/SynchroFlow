import { useQuery } from '@tanstack/react-query';

import { axiosInstance } from '../../api/axiosConfig';
import { useDebounce } from '../../hooks/useDebounce';

export type GlobalSearchResult = {
  type: 'order' | 'variant' | 'batch';
  id: string;
  label: string;
  secondary: string | null;
  meta: string | null;
  match: string;
};

export function useGlobalSearch(query: string, consoleOpen: boolean) {
  const debouncedQuery = useDebounce(query, 175);
  const trimmedQuery = debouncedQuery.trim();

  return useQuery<{ results: GlobalSearchResult[] }>({
    queryKey: ['global-search', debouncedQuery],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/search', {
        params: { q: trimmedQuery },
      });
      return data;
    },
    enabled: consoleOpen && trimmedQuery.length >= 2,
  });
}

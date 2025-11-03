import { renderHook } from '@testing-library/react';
// This import will fail
import { useNativeSearch } from 'components/OpsCommandCenter/hooks/useNativeSearch';

// Define a minimal OpsAction type for testing
type MockAction = {
  id: string;
  name: string;
  keywords: string[];
  description: string;
};

// Our sample data pool to search against
const mockActions: MockAction[] = [
  {
    id: '1',
    name: 'Find Order',
    keywords: ['search', 'lookup'],
    description: 'Look up a specific order by its number',
  },
  {
    id: '2',
    name: 'Find Customer',
    keywords: ['user', 'lookup'],
    description: 'Search for a customer by email or name',
  },
  {
    id: '3',
    name: 'Refund Order',
    keywords: ['money', 'return'],
    description: 'Process a full or partial refund',
  },
];

describe('useNativeSearch', () => {
  it('should return all items if query is empty', () => {
    const { result } = renderHook(() =>
      useNativeSearch(mockActions, '', ['name', 'keywords', 'description']),
    );
    expect(result.current.length).toBe(3);
  });

  it('should filter by a single term (case-insensitive)', () => {
    const { result } = renderHook(() =>
      useNativeSearch(mockActions, 'find', ['name', 'keywords', 'description']),
    );
    expect(result.current.length).toBe(2); // Find Order, Find Customer
    expect(result.current[0].id).toBe('1');
  });

  it('should filter by multiple terms (AND logic)', () => {
    const { result } = renderHook(() =>
      useNativeSearch(mockActions, 'find order', [
        'name',
        'keywords',
        'description',
      ]),
    );
    expect(result.current.length).toBe(1); // Only "Find Order"
    expect(result.current[0].id).toBe('1');
  });

  it('should handle multi-term query regardless of order', () => {
    const { result } = renderHook(() =>
      useNativeSearch(mockActions, 'order find', [
        'name',
        'keywords',
        'description',
      ]),
    );
    expect(result.current.length).toBe(1); // Still "Find Order"
    expect(result.current[0].id).toBe('1');
  });

  it('should search across all provided keys (e.g., keywords)', () => {
    const { result } = renderHook(() =>
      useNativeSearch(mockActions, 'lookup', [
        'name',
        'keywords',
        'description',
      ]),
    );
    expect(result.current.length).toBe(2); // Find Order, Find Customer
  });

  it('should return an empty array if no matches are found', () => {
    const { result } = renderHook(() =>
      useNativeSearch(mockActions, 'nonexistent', [
        'name',
        'keywords',
        'description',
      ]),
    );
    expect(result.current.length).toBe(0);
  });

  it('should correctly rank matches (name > keywords > description)', () => {
    const rankingData: MockAction[] = [
      {
        id: 'desc',
        name: 'Alpha',
        keywords: ['beta'],
        description: 'This is a test match', // Match here
      },
      {
        id: 'name',
        name: 'Test Match', // Match here (highest score)
        keywords: ['beta'],
        description: 'Lorem ipsum',
      },
      {
        id: 'keys',
        name: 'Charlie',
        keywords: ['test', 'match'], // Match here (mid score)
        description: 'Lorem ipsum',
      },
    ];

    const { result } = renderHook(() =>
      useNativeSearch(rankingData, 'test match', [
        'name',
        'keywords',
        'description',
      ]),
    );
    
    expect(result.current.length).toBe(3);
    // Check the order based on ranking
    expect(result.current[0].id).toBe('name');
    expect(result.current[1].id).toBe('keys');
    expect(result.current[2].id).toBe('desc');
  });
});
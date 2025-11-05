//tests/unit/ui/hooks/useFuseSearch.test.tsx
import { renderHook } from '@testing-library/react';
import { useFuseSearch } from 'components/OpsCommandCenter/hooks/useFuseSearch';

type MockItem = {
  name: string;
  keywords: string;
};

const mockData: MockItem[] = [
  { name: 'Go to Dashboard', keywords: 'home main' },
  { name: 'View Orders', keywords: 'shipping sales' },
  { name: 'Find Customer', keywords: 'users clients' },
];

// Define the keys we will search on
const keys = ['name', 'keywords'];

describe('useFuseSearch', () => {
  it('should return all items for an empty query', () => {
    const { result } = renderHook(() => useFuseSearch(mockData, '', keys));
    expect(result.current.length).toBe(3);
  });

  it('should find an exact match', () => {
    const { result } = renderHook(() =>
      useFuseSearch(mockData, 'View Orders', keys),
    );
    expect(result.current.length).toBe(1);
    expect(result.current[0].name).toBe('View Orders');
  });

  it('should find a fuzzy match (typo)', () => {
    // Test for a typo: "Cusotmer"
    const { result } = renderHook(() =>
      useFuseSearch(mockData, 'Cusotmer', keys),
    );
    expect(result.current.length).toBe(1);
    expect(result.current[0].name).toBe('Find Customer');
  });

  it('should find a fuzzy match (plural)', () => {
    // Test for plural: "Orders"
    const { result } = renderHook(() =>
      useFuseSearch(mockData, 'Orders', keys),
    );
    expect(result.current.length).toBe(1);
    expect(result.current[0].name).toBe('View Orders');
  });

  it('should search by keyword', () => {
    // Test keyword: "clients"
    const { result } = renderHook(() =>
      useFuseSearch(mockData, 'clients', keys),
    );
    expect(result.current.length).toBe(1);
    expect(result.current[0].name).toBe('Find Customer');
  });

  it('should return an empty array for no matches', () => {
    const { result } = renderHook(() =>
      useFuseSearch(mockData, 'nonexistentxyz', keys),
    );
    expect(result.current.length).toBe(0);
  });
});
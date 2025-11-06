// tests/unit/ui/hooks/usePersonalization.test.tsx
import { renderHook, act } from '@testing-library/react';
import { usePersonalization } from 'components/OpsCommandCenter/hooks/usePersonalization';

const LOCAL_STORAGE_KEY = 'kore_personalization';

describe('usePersonalization', () => {
  let mockStorage: Record<string, string> = {};
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockStorage = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn((key: string) => mockStorage[key] ?? null),
        setItem: jest.fn((key: string, value: string) => {
          mockStorage[key] = value;
        }),
        clear: jest.fn(() => {
          mockStorage = {};
        }),
      },
      writable: true,
    });

    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes with empty map when no storage exists', () => {
    const { result } = renderHook(() => usePersonalization());
    expect(result.current.getRankingBoost('any-id')).toBe(1.0);
  });

  it('loads existing preferences from storage', () => {
    mockStorage[LOCAL_STORAGE_KEY] = JSON.stringify({ 'find-order': 2, 'find-customer': 1 });
    const { result } = renderHook(() => usePersonalization());
    expect(result.current.getRankingBoost('find-order')).toBe(1.2);
    expect(result.current.getRankingBoost('find-customer')).toBe(1.1);
  });

  it('handles malformed JSON in storage gracefully', () => {
    mockStorage[LOCAL_STORAGE_KEY] = 'invalid-json';
    const { result } = renderHook(() => usePersonalization());
    expect(result.current.getRankingBoost('any-id')).toBe(1.0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Kore] Failed to parse personalization preferences:',
      expect.any(SyntaxError)
    );
  });

  it('tracks single selection and updates storage', () => {
    const { result } = renderHook(() => usePersonalization());
    act(() => {
      result.current.trackActionSelection('find-order');
    });
    const stored = JSON.parse(mockStorage[LOCAL_STORAGE_KEY]);
    expect(stored['find-order']).toBe(1);
  });

  it('increments counts for multiple selections on different actions', () => {
    const { result } = renderHook(() => usePersonalization());
    act(() => {
      result.current.trackActionSelection('find-order');
      result.current.trackActionSelection('find-order');
      result.current.trackActionSelection('find-customer');
    });
    const stored = JSON.parse(mockStorage[LOCAL_STORAGE_KEY]);
    expect(stored['find-order']).toBe(2);
    expect(stored['find-customer']).toBe(1);
  });

  it('handles storage save errors gracefully', () => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        ...window.localStorage,
        setItem: jest.fn(() => {
          throw new Error('Storage error');
        }),
      },
      writable: true,
    });

    const { result } = renderHook(() => usePersonalization());
    act(() => {
      result.current.trackActionSelection('find-order');
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Kore] Failed to save personalization preferences:',
      expect.any(Error)
    );
    // Internal ref still updates
    expect(result.current.getRankingBoost('find-order')).toBe(1.1);
  });

  describe('getRankingBoost', () => {
    test.each([
      { count: 0, expected: 1.0 },
      { count: 1, expected: 1.1 },
      { count: 2, expected: 1.2 },
      { count: 3, expected: 1.2 },
      { count: 4, expected: 1.3 },
      { count: 10, expected: 1.3 },
    ])('returns $expected for count $count', ({ count, expected }) => {
      const { result } = renderHook(() => usePersonalization());
      for (let i = 0; i < count; i++) {
        act(() => result.current.trackActionSelection('test-action'));
      }
      // Re-render to simulate load from storage
      const { result: reloaded } = renderHook(() => usePersonalization());
      expect(reloaded.current.getRankingBoost('test-action')).toBe(expected);
    });
  });

  it('persists changes across hook instances', () => {
    const { result: first } = renderHook(() => usePersonalization());
    act(() => {
      first.current.trackActionSelection('find-order');
      first.current.trackActionSelection('find-order');
      first.current.trackActionSelection('find-order');
    });

    const { result: second } = renderHook(() => usePersonalization());
    expect(second.current.getRankingBoost('find-order')).toBe(1.2);
    expect(second.current.getRankingBoost('unknown')).toBe(1.0);
  });
});
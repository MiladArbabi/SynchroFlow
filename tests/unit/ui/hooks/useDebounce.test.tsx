//tests/unit/ui/hooks/useDebounce.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from 'hooks/useDebounce';

// We must use fake timers to control the setTimeout
jest.useFakeTimers();

describe('useDebounce', () => {
  it('should return the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 150));
    expect(result.current).toBe('initial');
  });

  it('should not update the value immediately', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'first', delay: 150 } }
    );

    // Initial value is correct
    expect(result.current).toBe('first');

    // Re-render with a new value
    rerender({ value: 'second', delay: 150 });

    // The value should NOT have updated yet
    expect(result.current).toBe('first');
  });

  it('should update the value after the delay has passed', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'first', delay: 150 } }
    );

    // Re-render with a new value
    rerender({ value: 'second', delay: 150 });

    // The value is still the old one
    expect(result.current).toBe('first');

    // --- Fast-forward time ---
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // NOW the value should be updated
    expect(result.current).toBe('second');
  });

  it('should only update with the *latest* value after multiple rapid changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 150 } }
    );

    // Fire off multiple changes, all within the delay
    rerender({ value: 'b', delay: 150 });
    act(() => { jest.advanceTimersByTime(50); });
    rerender({ value: 'c', delay: 150 });
    act(() => { jest.advanceTimersByTime(50); });
    rerender({ value: 'd', delay: 150 });
    act(() => { jest.advanceTimersByTime(50); });

    // The value should still be the original
    expect(result.current).toBe('a');

    // Now, let the timer complete
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // The value should jump straight to the *last* value
    expect(result.current).toBe('d');
  });
});
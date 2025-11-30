//apps/frontend/src/hooks/useDebounce.ts
import { useState, useEffect } from 'react';

/**
 * A custom hook that debounces a value.
 *
 * @param value The value to debounce (e.g., a search query)
 * @param delay The delay in milliseconds (e.g., 150)
 * @returns The debounced value
 */
export const useDebounce = <T>(value: T, delay: number): T => {
  // State to store the debounced value
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up a timer to update the debounced value after the delay
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Clean up the timer if the value changes (or component unmounts)
    // This is the key to debouncing: we cancel the old timer.
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]); // Only re-run if value or delay changes

  return debouncedValue;
};
//packages/ui/src/components/OpsCommandCenter/hooks/usePersonalization.ts
import { useCallback, useRef } from 'react';

const LOCAL_STORAGE_KEY = 'kore_personalization';

// Define the shape of our stored preferences
type PreferenceMap = Record<string, number>; // e.g., { "find-order": 5, "find-customer": 2 }

/**
 * Loads the preference map from localStorage.
 */
const loadPreferences = (): PreferenceMap => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (error) {
    console.warn('[Kore] Failed to parse personalization preferences:', error);
  }
  return {};
};

/**
 * Saves the preference map to localStorage.
 */
const savePreferences = (prefs: PreferenceMap) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn('[Kore] Failed to save personalization preferences:', error);
  }
};

/**
 * A hook to manage user-specific action rankings.
 * It tracks user selections and provides a boost score.
 */
export const usePersonalization = () => {
  // We use useRef to hold the preferences. This avoids re-renders
  // every time we track a click, as the UI doesn't need to
  // update immediately. The *next* search will use the new score.
  const preferences = useRef<PreferenceMap>(loadPreferences());

  /**
   * Tracks that a user has selected a specific action.
   * This increments the action's count and saves to localStorage.
   */
  const trackActionSelection = useCallback((actionId: string) => {
    const currentCount = preferences.current[actionId] || 0;
    preferences.current[actionId] = currentCount + 1;
    savePreferences(preferences.current);
  }, []);

  /**
   * Gets a boost multiplier for a given action ID based on
   * how many times the user has selected it.
   */
  const getRankingBoost = useCallback((actionId: string): number => {
    const count = preferences.current[actionId] || 0;
    
    // We'll use a simple logarithmic boost to prevent one
    // action from dominating completely.
    // 0 clicks = 1.0 (default)
    // 1 click  = 1.1
    // 3 clicks = 1.2
    // 10 clicks = 1.3
    if (count === 0) return 1.0;
    if (count === 1) return 1.1;
    if (count <= 3) return 1.2;
    return 1.3;
  }, []);

  return { trackActionSelection, getRankingBoost };
};
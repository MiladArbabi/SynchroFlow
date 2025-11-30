// apps/frontend/src/hooks/useSessionTracking.ts
import { useState, useEffect, useCallback } from 'react';
import { generateSessionId, getFingerprint, shouldCreateNewSession } from '../utils/sessionUtils';
import { saveSessionData } from '../api/user-state';

export interface SessionData {
  sessionId: string;
  fingerprint: string;
  pageViews: Array<{ path: string; timestamp: number }>;
  createdAt: number;
  lastActivityAt: number;
}

export const useSessionTracking = () => {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isReturningVisitor, setIsReturningVisitor] = useState(false);

  // Initialize session
  useEffect(() => {
    const initializeSession = () => {
      let sessionData: SessionData | null = null;

      // Try to get existing session from localStorage
      try {
        const storedSession = localStorage.getItem('specter_session');
        if (storedSession) {
          sessionData = JSON.parse(storedSession);
        }
      } catch (error) {
        console.warn('Failed to read session from localStorage:', error);
      }

      // Check if we need to create a new session
      if (shouldCreateNewSession(sessionData)) {
        const newSession: SessionData = {
          sessionId: generateSessionId(),
          fingerprint: getFingerprint(),
          pageViews: [],
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        };

        // Check if this fingerprint has been seen before
        try {
          const knownFingerprints = JSON.parse(localStorage.getItem('specter_known_fingerprints') || '[]');
          if (knownFingerprints.includes(newSession.fingerprint)) {
            setIsReturningVisitor(true);
          } else {
            // Add new fingerprint to known list
            knownFingerprints.push(newSession.fingerprint);
            localStorage.setItem('specter_known_fingerprints', JSON.stringify(knownFingerprints));
          }
        } catch (error) {
          console.warn('Failed to check known fingerprints:', error);
        }

        sessionData = newSession;
      } else {
        // Update last activity for existing session
        sessionData!.lastActivityAt = Date.now();
        setIsReturningVisitor(true);
      }

      // Update session state and localStorage
      setSession(sessionData);
      try {
        localStorage.setItem('specter_session', JSON.stringify(sessionData));
      } catch (error) {
        console.warn('Failed to save session to localStorage:', error);
      }
    };

    initializeSession();
  }, []);

  const trackPageView = useCallback((path: string) => {
    setSession(prevSession => {
      if (!prevSession) return prevSession;

      const updatedSession = {
        ...prevSession,
        pageViews: [...prevSession.pageViews, { path, timestamp: Date.now() }],
        lastActivityAt: Date.now(),
      };

      // Update localStorage
      try {
        localStorage.setItem('specter_session', JSON.stringify(updatedSession));
      } catch (error) {
        console.warn('Failed to update session in localStorage:', error);
      }

      return updatedSession;
    });
  }, []);

  const persistSession = useCallback(async () => {
    if (!session) return;

    try {
      await saveSessionData(session);
    } catch (error) {
      console.warn('Failed to persist session to server:', error);
    }
  }, [session]);

  return {
    sessionId: session?.sessionId || null,
    fingerprint: session?.fingerprint || null,
    pageViews: session?.pageViews || [],
    isReturningVisitor,
    trackPageView,
    persistSession,
  };
};
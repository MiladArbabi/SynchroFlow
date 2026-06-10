// apps/mobile/src/ui/SessionShell.tsx
//
// SESSION SHELL — §10.7 shared component (MOB-UX-01)
// ------------------------------------------------
// Generic phase-state machine for all WMS workflow sessions.
// Wraps Receive, Stow, and Pick screen stacks.
//
// RESPONSIBILITIES (§10.7):
//   1. Phase state machine  — setPhase() with arbitrary string phases.
//   2. AsyncStorage persistence — full phase + phaseData snapshot on every
//      transition; restores on remount (DECISION-E).
//      Key: ls:session:{sessionKey}
//   3. Hardware / gesture back-guard — intercepts navigation.beforeRemove
//      on activePhases; shows leave-session confirm dialog.
//   4. device_event_id generation — newEventId() provides a fresh UUID v4
//      for each mutating scan action. Screens call once per action, not per
//      retry — pass the same ID on network retries for server deduplication.
//   5. sessionId — stable UUID for the lifetime of this session mount.
//
// RESOLVES (structurally): MOB-AUD-06, MOB-RCV-04, MOB-STW-05/-06,
//   MOB-PCK-08/-10. Per-screen re-composition happens in MOB-RECEIVE-01 etc.
//
// CONTRACT (§6, §10.7):
//   - NO API calls in this component.
//   - Screens own data fetching; SessionShell owns lifecycle + persistence.
//   - phaseData must be JSON-serializable (scalars, arrays, plain objects).
//
// CHANGE CONTROL: consumed by every Work screen (Receive, Stow, Pick).
// Test all workflow surfaces after any change here.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

// ─── UUID v4 ─────────────────────────────────────────────────────────────────
// Math.random() is sufficient for device_event_id idempotency.
// The server deduplicates via UNIQUE constraint — not cryptographic validation.
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── AsyncStorage ────────────────────────────────────────────────────────────
const STORAGE_PREFIX = 'ls:session:';

interface PersistedSession {
  phase: string;
  phaseData: Record<string, unknown>;
  sessionId: string;
  savedAt: number; // epoch ms — available for future stale-session detection
}

// ─── Context ─────────────────────────────────────────────────────────────────
export interface SessionContextValue {
  /** Current phase name */
  phase: string;
  /**
   * Arbitrary JSON-serializable data stored alongside the phase.
   * Populated by setPhase(); available on resume via AsyncStorage restore.
   * Use to snapshot: confirmedLocation, currentItemIndex, scannedUnitIds, etc.
   */
  phaseData: Record<string, unknown>;
  /** Stable UUID for the lifetime of this session mount */
  sessionId: string;
  /** True while reading persisted state from AsyncStorage on mount */
  isRestoring: boolean;
  /**
   * Transition to a new phase, optionally snapshotting phaseData.
   * Persists to AsyncStorage synchronously before returning.
   */
  setPhase: (phase: string, data?: Record<string, unknown>) => Promise<void>;
  /**
   * Generate a fresh device_event_id UUID for one mutating scan action.
   * Call once per user action; reuse the same ID on network retries.
   */
  newEventId: () => string;
  /**
   * Remove persisted session state from AsyncStorage.
   * Call on terminal phase (done / closed). Does NOT navigate — caller drives.
   */
  clearSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Consume session context inside any descendant of <SessionShell>. */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession() must be called inside <SessionShell>');
  return ctx;
}

// ─── Props ───────────────────────────────────────────────────────────────────
export interface SessionShellProps {
  /**
   * Unique AsyncStorage key discriminator.
   * Pattern: "{workflow}:{taskId}" — e.g. "pick:batch-abc123"
   */
  sessionKey: string;
  /** Phase to start from when no persisted state exists */
  initialPhase: string;
  /**
   * Phases where hardware/gesture back is guarded with a confirm dialog.
   * Brief and terminal (done/closed) phases are typically NOT listed here.
   *
   * Receive:  ['inspect', 'scan', 'summary']
   * Stow:     ['location_scan', 'product_scan', 'qty_confirm', 'summary']
   * Pick:     ['scan', 'summary']
   */
  activePhases: readonly string[];
  children: React.ReactNode;
}

// ─── SessionShell ─────────────────────────────────────────────────────────────
export function SessionShell({
  sessionKey,
  initialPhase,
  activePhases,
  children,
}: SessionShellProps) {
  const navigation = useNavigation();
  const storageKey = `${STORAGE_PREFIX}${sessionKey}`;

  const [isRestoring, setIsRestoring] = useState(true);
  const [phase, setPhaseState] = useState(initialPhase);
  const [phaseData, setPhaseData] = useState<Record<string, unknown>>({});

  // Refs — stable identifiers that don't trigger re-renders
  const sessionIdRef = useRef<string>(uuidv4());
  // phaseRef lets the back-guard closure read current phase without re-registering
  const phaseRef = useRef(phase);

  // ── Keep phaseRef current ───────────────────────────────────────────────
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // ── Restore persisted state on mount ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw && !cancelled) {
          const saved: PersistedSession = JSON.parse(raw);
          setPhaseState(saved.phase);
          setPhaseData(saved.phaseData ?? {});
          sessionIdRef.current = saved.sessionId;
        }
      } catch {
        // Corrupt / missing — start fresh from initialPhase. Non-fatal.
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();
    return () => { cancelled = true; };
  // storageKey is stable for this mount; intentionally omitting dynamic deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // ── Phase transition + persist ──────────────────────────────────────────
  const setPhase = useCallback(async (
    nextPhase: string,
    data: Record<string, unknown> = {},
  ): Promise<void> => {
    setPhaseState(nextPhase);
    setPhaseData(data);
    const snapshot: PersistedSession = {
      phase: nextPhase,
      phaseData: data,
      sessionId: sessionIdRef.current,
      savedAt: Date.now(),
    };
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // Storage failure is non-fatal; operator can continue without persistence.
    }
  }, [storageKey]);

  // ── Clear persisted state on terminal phase ──────────────────────────────
  const clearSession = useCallback(async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch {
      // Ignore — stale entry will be overwritten on next session.
    }
  }, [storageKey]);

  // ── device_event_id generator ────────────────────────────────────────────
  const newEventId = useCallback((): string => uuidv4(), []);

  // ── Back guard ───────────────────────────────────────────────────────────
  // Uses phaseRef (not phase state) so this effect only re-runs when
  // navigation or activePhases changes — not on every phase transition.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = (navigation as any).addListener(
      'beforeRemove',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => {
        if (!activePhases.includes(phaseRef.current)) {
          return; // Brief and terminal phases allow free back navigation
        }
        e.preventDefault();
        Alert.alert(
          'Leave session?',
          'Your progress is saved. You can resume this task anytime.',
          [
            { text: 'Stay', style: 'cancel' },
            {
              text: 'Leave',
              style: 'destructive',
              onPress: () => navigation.dispatch(e.data.action),
            },
          ],
          { cancelable: true },
        );
      },
    );
    return unsubscribe;
  }, [navigation, activePhases]);

  // ── Context value ─────────────────────────────────────────────────────────
  const value: SessionContextValue = {
    phase,
    phaseData,
    sessionId: sessionIdRef.current,
    isRestoring,
    setPhase,
    newEventId,
    clearSession,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}
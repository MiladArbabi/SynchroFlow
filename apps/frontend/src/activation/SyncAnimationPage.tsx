/* eslint-disable react-hooks/exhaustive-deps */
// apps/frontend/src/activation/SyncAnimationPage.tsx
//
// PURPOSE:
// FT0 sync animation — shown immediately after Shopify OAuth succeeds.
//
// THEME: uses useColorScheme() (MUI v6 pattern) — matches codebase convention.
//   colorScheme === 'dark' → dark palette  |  else → light palette
//
// STEP SEQUENCE:
//   0 — Real      — PENDING/SYNCING_PRODUCTS  — Connecting to Shopify
//   1 — Real      — SYNCING_PRODUCTS          — Reading your catalogue (variants counter)
//   2 — Real      — SYNCING_ORDERS            — Mapping your orders    (orders counter, live)
//   3 — Synthetic — 8s after step 2 activates — Calculating margin per order
//   4 — Real      — COMPLETED                 — Building your Morning Brief
//
// DONE TRANSITION RULES:
//   Steps 0, 1    → marked done when next step activates (normal queue flow)
//   Steps 2, 3    → marked done only on COMPLETED (they run concurrently during order sync)
//   Step 4        → stays orange until FT1 unmounts this component
//
// STEP STATE COLORS:
//   pending → invisible
//   active  → #FF6B2B orange + pulse
//   done    → #22C55E green static

import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { CheckCircle, Clock, Volume2, VolumeX } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { ThemeMode } from 'config';

// ─── Brand tokens (accent + semantic only) ────────────────────────────────────

const ACCENT       = '#FF6B2B';
const ACCENT_HOVER = '#FF8C5A';
const ACCENT_GHOST = 'rgba(255, 107, 43, 0.12)';
const ACCENT_BORDER= 'rgba(255, 107, 43, 0.25)';
const GREEN        = '#22C55E';

// ─── Theme-derived palette (mirrors codebase pattern from MainCard.tsx) ───────

function useSyncTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === ThemeMode.DARK;
  return {
    isDark,
    bg:          isDark ? '#151D29' : '#F8F9FA',
    surface:     isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)',
    divider:     isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    textHint:    isDark ? '#5A5F6E' : '#9CA3AF',
    actionHover: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    stepBorder:  isDark ? '#2E3D62' : '#E5E7EB',
    shadow:      isDark
      ? '0 24px 64px rgba(0,0,0,0.5)'
      : '0 8px 32px rgba(0,0,0,0.12)',
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type StepState = 'pending' | 'active' | 'done';

interface SyncCounts {
  orders: number;
  variants: number;
  customers: number;
}

interface SyncStatusResponse {
  status: string;
  progress: { current: number; total: number; percentage: number };
  counts: SyncCounts;
  lastError: string | null;
}

interface StepDef {
  heading: string;
  subheading: (counts: SyncCounts) => string;
  detail: string;
  counterKey?: keyof SyncCounts;
  /** If true, only marked done on COMPLETED — not when next step activates */
  doneOnCompleted?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_TO_STEP: Record<string, number> = {
  PENDING:           0,
  SYNCING_PRODUCTS:  1,
  SYNCING_ORDERS:    2,
  SYNCING_INVENTORY: 2,
  SYNCING_SHOP:      2,
  COMPLETING:        4,
  // COMPLETED handled separately
};

const POLL_INTERVAL_MS        = 2000;
const MIN_STEP_DISPLAY_MS     = 1200;
const SYNTHETIC_STEP_DELAY_MS = 8000;
const REASSURANCE_DELAY_MS    = 90_000;

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  {
    heading:    'Connecting to Shopify',
    subheading: () => '',
    detail:     'Authenticating your store · verifying permissions',
  },
  {
    heading:    'Reading your catalogue',
    subheading: (c) => `${c.variants.toLocaleString()} products found`,
    detail:     'Mapping variants · assigning LaSyncro identifiers · building inventory ledger',
    counterKey: 'variants',
  },
  {
    heading:         'Mapping your orders',
    subheading:      (c) => `${c.orders.toLocaleString()} orders synced`,
    detail:          'Ingesting order history · linking fulfilment records · building your timeline',
    counterKey:      'orders',
    doneOnCompleted: true, // stays orange until COMPLETED — orders keep climbing
  },
  {
    heading:         'Calculating margin per order',
    subheading:      () => '',
    detail:          'Risk-scoring delays · identifying fulfilment gaps · projecting restock needs',
    doneOnCompleted: true, // synthetic — runs concurrently with orders, done on COMPLETED
  },
  {
    heading:    'Building your Morning Brief',
    subheading: () => '',
    detail:     "Composing today's operational snapshot · prioritising what needs attention first",
    // Stays orange until LifecycleProvider unmounts this component on FT1
  },
];

const PHASE_HEADINGS: Record<number, string> = {
  0: 'Connecting…',
  1: 'Reading your catalogue',
  2: 'Mapping your orders',
  3: 'Finding your risks',
  4: 'Building your brief',
};

// ─── useCountUp ───────────────────────────────────────────────────────────────

function useCountUp(target: number, duration: number, active: boolean): number {
  const [value, setValue] = useState(0);
  const rafRef        = useRef<number | null>(null);
  const startRef      = useRef<number | null>(null);
  const startValueRef = useRef(0);
  const prevTargetRef = useRef(0);

  useEffect(() => {
    if (!active || target === 0) return;
    if (target === prevTargetRef.current) return;

    startValueRef.current = value;
    prevTargetRef.current = target;
    startRef.current = null;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    function animate(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed  = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(startValueRef.current + eased * (target - startValueRef.current)));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [active, target, duration]); // value intentionally omitted — captured via startValueRef

  return value;
}

// ─── StepRow ──────────────────────────────────────────────────────────────────

interface StepRowProps {
  step:   StepDef;
  state:  StepState;
  counts: SyncCounts;
  pal:    ReturnType<typeof useSyncTheme>;
}

const StepRow: React.FC<StepRowProps> = ({ step, state, counts, pal }) => {
  const isVisible = state === 'active' || state === 'done';
  const isDone    = state === 'done';
  const isActive  = state === 'active';

  const targetCount   = step.counterKey ? counts[step.counterKey] : 0;
  const animatedCount = useCountUp(targetCount, 1500, isVisible && !!step.counterKey);
  const displayCount  = isDone ? targetCount : animatedCount;

  const displayCounts: SyncCounts = {
    ...counts,
    ...(step.counterKey ? { [step.counterKey]: displayCount } : {}),
  };

  const iconColor = isDone ? GREEN : ACCENT;
  const subline   = step.subheading(displayCounts);

  return (
    <Box
      sx={{
        display:    'flex',
        alignItems: 'flex-start',
        gap:        1.5,
        mb:         2.5,
        opacity:    isVisible ? 1 : 0,
        transform:  isVisible ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
      }}
    >
      <Box
        sx={{
          mt:         '2px',
          flexShrink: 0,
          '@keyframes stepPulse': {
            '0%, 100%': { opacity: 1,    transform: 'scale(1)' },
            '50%':      { opacity: 0.55, transform: 'scale(0.88)' },
          },
          animation: isActive ? 'stepPulse 1.4s ease-in-out infinite' : 'none',
        }}
      >
        <CheckCircle size={18} color={iconColor} />
      </Box>

      <Box sx={{ flex: 1 }}>
        <Typography
          sx={{
            fontSize:      '0.7rem',
            fontWeight:    700,
            color:         isDone ? GREEN : ACCENT,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            transition:    'color 0.4s ease',
          }}
        >
          {step.heading}
        </Typography>

        {isVisible && subline.length > 0 && (
          <Typography
            sx={{
              fontSize:           '1rem',
              fontWeight:         700,
              color:              pal.textPrimary,
              mt:                 0.25,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {subline}
          </Typography>
        )}

        <Typography sx={{ fontSize: '0.72rem', color: pal.textSecond, mt: 0.25, lineHeight: 1.6 }}>
          {step.detail}
        </Typography>
      </Box>
    </Box>
  );
};

// ─── SyncAnimationPage ────────────────────────────────────────────────────────

const SyncAnimationPage: React.FC = () => {
  const pal = useSyncTheme();

  const [stepStates, setStepStates]           = useState<StepState[]>(STEPS.map(() => 'pending'));
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [showTeaser, setShowTeaser]           = useState(false);
  const [showReassurance, setShowReassurance] = useState(false);
  const [soundEnabled, setSoundEnabled]       = useState(false);
  const [counts, setCounts]                   = useState<SyncCounts>({ orders: 0, variants: 0, customers: 0 });
  const [progressWidth, setProgressWidth]     = useState(0);

  const completedSequenceRunRef  = useRef(false);
  const teaserShownRef           = useRef(false);
  const syntheticStepQueuedRef   = useRef(false);
  const syntheticStepTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allTimersRef             = useRef<ReturnType<typeof setTimeout>[]>([]);
  const soundEnabledRef          = useRef(false);

  const addTimer = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    allTimersRef.current.push(t);
    return t;
  };

  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  const playCompletionChime = () => {
    if (!soundEnabledRef.current) return;
    try {
      const ctx  = new AudioContext();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch { /* AudioContext unavailable — silent fail */ }
  };

  // ── Explicit state setters ────────────────────────────────────────────────

  const activateStep = (index: number) => {
    setActiveStepIndex(index);
    setProgressWidth(((index + 1) / STEPS.length) * 100);
    setStepStates((prev) => {
      if (prev[index] !== 'pending') return prev;
      const next = [...prev] as StepState[];
      next[index] = 'active';
      return next;
    });
  };

  /**
   * markStepDone — only marks done if step does NOT have doneOnCompleted.
   * Steps 2 + 3 are marked done only in runCompletedSequence.
   */
  const markStepDone = (index: number) => {
    if (STEPS[index]?.doneOnCompleted) return; // guard — these wait for COMPLETED
    setStepStates((prev) => {
      if (prev[index] !== 'active') return prev;
      const next = [...prev] as StepState[];
      next[index] = 'done';
      return next;
    });
  };

  /** markStepDoneForced — used only in runCompletedSequence for doneOnCompleted steps */
  const markStepDoneForced = (index: number) => {
    setStepStates((prev) => {
      if (prev[index] !== 'active') return prev;
      const next = [...prev] as StepState[];
      next[index] = 'done';
      return next;
    });
  };

  // ── Poll + sequencing ─────────────────────────────────────────────────────

  useEffect(() => {
    let pollCancelled = false;
    let mainPollId: ReturnType<typeof setInterval> | null = null;
    let countsPollId: ReturnType<typeof setInterval> | null = null;

    const stepQueue: number[] = [];
    let stepSchedulerRunning  = false;
    let currentDisplayStep    = -1;

    const stopMainPoll = () => {
      pollCancelled = true;
      if (mainPollId !== null) { clearInterval(mainPollId); mainPollId = null; }
    };

    const stopCountsPoll = () => {
      if (countsPollId !== null) { clearInterval(countsPollId); countsPollId = null; }
    };

    function processQueue() {
      if (stepSchedulerRunning) return;

      while (stepQueue.length > 0 && stepQueue[0] <= currentDisplayStep) {
        stepQueue.shift();
      }

      if (stepQueue.length === 0) return;

      const nextStep = stepQueue[0];

      // Fill skipped steps
      if (nextStep > currentDisplayStep + 1) {
        for (let i = currentDisplayStep + 1; i < nextStep; i++) {
          stepQueue.unshift(i);
        }
      }

      const stepToShow = stepQueue.shift()!;
      if (stepToShow <= currentDisplayStep) { processQueue(); return; }

      stepSchedulerRunning = true;
      currentDisplayStep   = stepToShow;

      activateStep(stepToShow);

      // Mark previous step done — only if it's not a doneOnCompleted step
      if (stepToShow > 0) markStepDone(stepToShow - 1);

      // Queue synthetic step 3 eight seconds after step 2 activates
      if (stepToShow === 2 && !syntheticStepQueuedRef.current) {
        syntheticStepQueuedRef.current = true;
        syntheticStepTimerRef.current = setTimeout(() => {
          enqueueStep(3);
        }, SYNTHETIC_STEP_DELAY_MS);
      }

      addTimer(() => {
        stepSchedulerRunning = false;
        processQueue();
      }, MIN_STEP_DISPLAY_MS);
    }

    function enqueueStep(index: number) {
      const lastQueued = stepQueue[stepQueue.length - 1] ?? currentDisplayStep;
      if (index > lastQueued) stepQueue.push(index);
      processQueue();
    }

    /**
     * runCompletedSequence — fires exactly once on COMPLETED.
     *
     * Timeline:
     *   0ms   — stop main poll, freeze counts
     *   0ms   — mark steps 2 + 3 done (green) — they were orange during order sync
     *   0ms   — enqueue step 4 through scheduler
     *   800ms — teaser appears
     *   chime — if opted in
     */
    const runCompletedSequence = (finalCounts: SyncCounts) => {
      if (completedSequenceRunRef.current) return;
      completedSequenceRunRef.current = true;

      stopMainPoll();
      setCounts(finalCounts);

      // Cancel synthetic step timer if COMPLETED arrives before 8s
      if (syntheticStepTimerRef.current !== null) {
        clearTimeout(syntheticStepTimerRef.current);
        syntheticStepTimerRef.current = null;
      }

      // Mark steps 2 and 3 done immediately (were orange during order sync)
      markStepDoneForced(2);
      markStepDoneForced(3);

      // Continue polling counts for projection catch-up
      countsPollId = setInterval(async () => {
        try {
          const { data } = await axiosInstance.get<SyncStatusResponse>('/api/v1/integrations/sync-status');
          if (data.counts) setCounts(data.counts);
        } catch { /* non-fatal */ }
      }, POLL_INTERVAL_MS);

      // Step 4 through scheduler — respects MIN_STEP_DISPLAY_MS
      enqueueStep(4);

      addTimer(() => {
        if (!teaserShownRef.current) {
          teaserShownRef.current = true;
          setShowTeaser(true);
        }
      }, 800);

      playCompletionChime();
    };

    async function poll() {
      if (pollCancelled) return;
      try {
        const { data } = await axiosInstance.get<SyncStatusResponse>('/api/v1/integrations/sync-status');
        if (pollCancelled) return;

        if (data.counts) setCounts(data.counts);

        if (data.status === 'COMPLETED') { runCompletedSequence(data.counts); return; }
        if (data.status === 'FAILED')    { stopMainPoll(); return; }

        const targetStep = STATUS_TO_STEP[data.status] ?? 0;
        enqueueStep(targetStep);

      } catch (err) {
        console.warn('[SyncAnimationPage] poll failed', err);
      }
    }

    poll();
    mainPollId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      stopMainPoll();
      stopCountsPoll();
      if (syntheticStepTimerRef.current !== null) clearTimeout(syntheticStepTimerRef.current);
      const timers = allTimersRef.current;
      timers.forEach(clearTimeout);
    };
  }, []); // intentionally runs once

  // Reassurance at 90s
  useEffect(() => {
    const t = setTimeout(() => setShowReassurance(true), REASSURANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const phaseHeading = activeStepIndex >= 0
    ? (PHASE_HEADINGS[activeStepIndex] ?? PHASE_HEADINGS[0])
    : 'Your operation is ready';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: pal.bg, px: 2 }}>
      <Box sx={{ width: '100%', maxWidth: 540, borderRadius: '12px', overflow: 'hidden', border: `1px solid ${pal.border}`, backgroundColor: pal.surface, boxShadow: pal.shadow }}>

        {/* Title bar */}
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.25, borderBottom: `1px solid ${pal.divider}`, backgroundColor: pal.bg, gap: 1 }}>
          {(['#FF5F57', '#FEBC2E', '#28C840'] as const).map((color) => (
            <Box key={color} sx={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: color }} />
          ))}
          <Typography sx={{ flex: 1, textAlign: 'center', fontSize: '0.68rem', color: pal.textHint, ml: -4, fontFamily: 'monospace' }}>
            app.lasyncro.com/sync
          </Typography>
          <Box
            onClick={() => setSoundEnabled((v) => !v)}
            sx={{ cursor: 'pointer', opacity: 0.5, '&:hover': { opacity: 1 }, transition: 'opacity 0.2s ease', flexShrink: 0 }}
            title={soundEnabled ? 'Mute completion sound' : 'Enable completion sound'}
          >
            {soundEnabled
              ? <Volume2 size={14} color={pal.textSecond} />
              : <VolumeX size={14} color={pal.textSecond} />
            }
          </Box>
        </Box>

        {/* Body */}
        <Box sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: ACCENT, letterSpacing: '0.14em', textTransform: 'uppercase', textAlign: 'center', mb: 0.75 }}>
            Syncing your rows
          </Typography>

          <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, color: pal.textPrimary, textAlign: 'center', mb: 0.5, letterSpacing: '-0.02em' }}>
            {phaseHeading}
          </Typography>

          <Typography sx={{ fontSize: '0.8rem', color: pal.textSecond, textAlign: 'center', mb: 3.5 }}>
            Loading your first Morning Brief…
          </Typography>

          {/* Steps */}
          <Box sx={{ mb: 3, pl: 1.5, borderLeft: `1px solid ${pal.stepBorder}`, ml: 0.5 }}>
            {STEPS.map((step, i) => (
              <StepRow key={i} step={step} state={stepStates[i]} counts={counts} pal={pal} />
            ))}
          </Box>

          {/* Progress bar */}
          <Box sx={{ height: 3, borderRadius: 2, backgroundColor: pal.actionHover, overflow: 'hidden', mb: 2.5 }}>
            <Box sx={{ height: '100%', width: `${progressWidth}%`, borderRadius: 2, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_HOVER})`, transition: 'width 0.9s cubic-bezier(0.4, 0, 0.2, 1)' }} />
          </Box>

          {/* Teaser — hidden when reassurance shows */}
          {!showReassurance && (
            <Box sx={{ minHeight: 44, borderRadius: '8px', border: `1px solid ${showTeaser ? ACCENT_BORDER : 'transparent'}`, backgroundColor: showTeaser ? ACCENT_GHOST : 'transparent', px: showTeaser ? 2 : 0, py: showTeaser ? 1.25 : 0, transition: 'all 0.5s ease', display: 'flex', alignItems: 'center' }}>
              {showTeaser && (
                <Typography sx={{ fontSize: '0.8rem', color: ACCENT, fontWeight: 600 }}>
                  We found something. Loading your operation now.
                </Typography>
              )}
            </Box>
          )}

          {/* Reassurance — 90s */}
          {showReassurance && (
            <Box sx={{ mt: 2, p: 2, borderRadius: '8px', backgroundColor: pal.actionHover, border: `1px solid ${pal.border}` }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1.5 }}>
                <Clock size={15} color={pal.textSecond} style={{ marginTop: 2, flexShrink: 0 }} />
                <Box>
                  <Typography sx={{ fontSize: '0.8rem', color: pal.textPrimary, fontWeight: 600, mb: 0.25 }}>
                    Still syncing — larger stores take a few minutes.
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: pal.textSecond }}>
                    You can wait here or jump in with what we've found so far.
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="contained" sx={{ backgroundColor: ACCENT, color: '#fff', fontSize: '0.75rem', textTransform: 'none', borderRadius: '6px', px: 1.5, py: 0.5, fontWeight: 600, '&:hover': { backgroundColor: ACCENT_HOVER } }}>
                  Continue to dashboard
                </Button>
                <Button size="small" sx={{ color: ACCENT, fontSize: '0.75rem', textTransform: 'none', border: `1px solid ${ACCENT_BORDER}`, borderRadius: '6px', px: 1.5, py: 0.5, '&:hover': { backgroundColor: ACCENT_GHOST } }}>
                  Email me when it's ready
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default SyncAnimationPage;
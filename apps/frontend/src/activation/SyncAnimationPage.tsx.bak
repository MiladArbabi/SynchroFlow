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
import { useAuth } from 'contexts/AuthContext';
import { useSyncStatus } from './hooks/useSyncStatus';
import { useSyncStepMachine } from './hooks/useSyncStepMachine';

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

interface StepDef {
  heading: string;
  subheading: (counts: SyncCounts) => string;
  detail: string;
  counterKey?: keyof SyncCounts;
  /** If true, only marked done on COMPLETED — not when next step activates */
  doneOnCompleted?: boolean;
}

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
  // source of truth: backend sync state (status + counts)
  const { status, counts: polledCounts, progress } = useSyncStatus();
  
  const {
    stepStates,
    activeStepIndex,
    progressWidth,
    showTeaser,
    showReassurance,
    isError
  } = useSyncStepMachine(status, polledCounts, STEPS.length, progress);
  
  const pal = useSyncTheme();
  const { user } = useAuth();
  
  const [soundEnabled, setSoundEnabled]       = useState(false);

  const [emailRequested, setEmailRequested]     = useState(false);
  const [emailInputVisible, setEmailInputVisible] = useState(false);
  const [emailInput, setEmailInput]             = useState('');

  const handleEmailNotify = async () => {
    if (emailRequested) return;
    try {
      await axiosInstance.post('/api/v1/integrations/sync-notify', {
        notifyEmail: emailInput.trim() || undefined,
      });
      setEmailRequested(true);
      setEmailInputVisible(false);
    } catch (err) {
      console.warn('[SyncAnimationPage] email notify failed', err);
    }
  };

  const phaseHeading = activeStepIndex >= 0
    ? (PHASE_HEADINGS[activeStepIndex] ?? PHASE_HEADINGS[0])
    : 'Your operation is ready';

  // explicit failure state — prevents misleading progress UI
  if (isError) {
    return (
      <Box
        sx={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pal.bg
        }}
      >
        <Box sx={{ textAlign: 'center', maxWidth: 320 }}>
          <Typography sx={{ fontSize: '1.2rem', fontWeight: 700, mb: 1 }}>
            Sync failed
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: pal.textSecond }}>
            Something went wrong while connecting your store.
          </Typography>
        </Box>
      </Box>
    );
  }

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
              <StepRow key={i} step={step} state={stepStates[i]} counts={polledCounts} pal={pal} />
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
                    You can wait here or check your email to be notified when sync is complete.
                  </Typography>
                </Box>
              </Box>
              {!emailRequested ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1 }}>
            {!emailInputVisible ? (
              <Button
                size="small"
                onClick={() => { setEmailInput(user?.email ?? ''); setEmailInputVisible(true); }}
                sx={{ color: ACCENT, fontSize: '0.75rem', textTransform: 'none', border: `1px solid ${ACCENT_BORDER}`, borderRadius: '6px', px: 1.5, py: 0.5, '&:hover': { backgroundColor: ACCENT_GHOST } }}
              >
                Email me when it's ready
              </Button>
            ) : (
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  style={{ flex: 1, minWidth: 160, padding: '4px 10px', borderRadius: 6, border: `1px solid ${ACCENT_BORDER}`, backgroundColor: 'transparent', color: pal.textPrimary, fontSize: '0.75rem', outline: 'none' }}
                  onKeyDown={e => { if (e.key === 'Enter') handleEmailNotify(); }}
                  autoFocus
                />
                <Button size="small" onClick={handleEmailNotify} sx={{ color: '#fff', backgroundColor: ACCENT, fontSize: '0.75rem', textTransform: 'none', borderRadius: '6px', px: 1.5, py: 0.5, flexShrink: 0, '&:hover': { backgroundColor: ACCENT_HOVER } }}>
                  Send
                </Button>
              </Box>
                )}
              </Box>
            ) : (
              <Typography sx={{ fontSize: '0.75rem', color: pal.textSecond }}>
                ✓ We'll email you when it's ready
              </Typography>
            )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default SyncAnimationPage;
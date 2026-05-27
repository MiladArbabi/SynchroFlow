// apps/frontend/src/activation/SyncAnimationPage.tsx
//
// PURPOSE: FT0 sync animation — shown immediately after Shopify OAuth succeeds.
// DESIGN: Two-column layout matching C___Brief_preview___Dark___Live target.
//
// STEP SEQUENCE (one visible at a time):
//   0 — CONNECTING        — Connecting to Shopify
//   1 — IMPORTING_PRODUCTS — Reading your catalogue (N of M variants)
//   2 — IMPORTING_ORDERS  — Mapping your orders (live climbing counter)
//   3 — PROCESSING        — Calculating margin per order
//   4 — FINALIZING/DONE   — Building your Morning Brief
//
// STEP REVEAL RULE: only the active step is visible. Previous steps show as
// green checkmarks. Future steps are hidden entirely — no peeking.

import React, { useRef } from 'react';
import { Box, Typography, Stack } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { CheckCircle, Zap } from 'lucide-react';
import { ThemeMode } from 'config';
import { useSyncStatus } from './hooks/useSyncStatus';
import { useSyncStepMachine } from './hooks/useSyncStepMachine';

// ─── Brand tokens ─────────────────────────────────────────────────────────────

const ACCENT        = '#FF6B2B';
const ACCENT_HOVER  = '#FF8C5A';
const GREEN         = '#22C55E';

// ─── Theme palette ────────────────────────────────────────────────────────────

function useSyncTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === ThemeMode.DARK;
  return {
    isDark,
    bg:          isDark ? '#0F1117' : '#F8F9FA',
    surface:     isDark ? '#161B27' : '#FFFFFF',
    surfaceHigh: isDark ? '#1C2333' : '#F3F4F6',
    border:      isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    divider:     isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#7C8290' : '#6B7280',
    textHint:    isDark ? '#4A4F5E' : '#9CA3AF',
    cardBg:      isDark ? '#1A2035' : '#F9FAFB',
    cardBorder:  isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  };
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const TOTAL_STEPS = 5;

interface StepDef {
  label:     string;
  detail:    string;
}

const STEPS: StepDef[] = [
  { label: 'Connecting to Shopify',      detail: 'Authenticating · verifying permissions' },
  { label: 'Reading your catalogue',     detail: 'Mapping variants · building inventory ledger' },
  { label: 'Mapping your orders',        detail: 'Ingesting order history · linking fulfilment records' },
  { label: 'Calculating margin per order', detail: 'Risk-scoring delays · projecting restock needs' },
  { label: 'Building your Morning Brief', detail: 'Prioritising what needs your attention first' },
];

// ─── StepItem ─────────────────────────────────────────────────────────────────

type StepState = 'pending' | 'active' | 'done';

interface StepItemProps {
  step:        StepDef;
  state:       StepState;
  stepIndex:   number;
  activeIndex: number;
  counts:      { orders: number; variants: number };
  progress:    { current: number; total: number; percentage: number } | null;
  pal:         ReturnType<typeof useSyncTheme>;
}

const StepItem: React.FC<StepItemProps> = ({ step, state, stepIndex, counts, progress, pal }) => {
  const isActive  = state === 'active';
  const isDone    = state === 'done';
  const isVisible = isActive || isDone;

  if (!isVisible) return null;

  // Sub-label per step
  let subLabel: React.ReactNode = null;

  if (stepIndex === 1 && isActive) {
    // Use progress.current as proxy when variants table not yet populated
    const current = counts.variants > 0 ? counts.variants : (progress?.current ?? 0);
    const total   = progress?.total ?? 0;
    subLabel = total > 0
      ? <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: pal.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
          {current.toLocaleString()} <Typography component="span" sx={{ fontSize: '0.8rem', color: pal.textSecond, fontWeight: 400 }}>of {total.toLocaleString()} products</Typography>
        </Typography>
      : current > 0
        ? <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: pal.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
            {current.toLocaleString()} <Typography component="span" sx={{ fontSize: '0.8rem', color: pal.textSecond, fontWeight: 400 }}>products found</Typography>
          </Typography>
        : null;
  }

  if (stepIndex === 1 && isDone) {
    subLabel = <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: GREEN, fontVariantNumeric: 'tabular-nums' }}>
      {counts.variants.toLocaleString()} <Typography component="span" sx={{ fontSize: '0.8rem', color: pal.textSecond, fontWeight: 400 }}>products synced</Typography>
    </Typography>;
  }

  if (stepIndex === 2 && isActive) {
    subLabel = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Box sx={{
          width: 6, height: 6, borderRadius: '50%', bgcolor: ACCENT, flexShrink: 0,
          '@keyframes orderPulse': {
            '0%, 100%': { opacity: 1, transform: 'scale(1)' },
            '50%':      { opacity: 0.3, transform: 'scale(0.7)' },
          },
          animation: 'orderPulse 1.2s ease-in-out infinite',
        }} />
        <Typography sx={{ fontSize: '0.85rem', color: pal.textSecond }}>
          Fetching order history — this takes a moment
        </Typography>
      </Box>
    );
  }
  if (stepIndex === 2 && isDone) {
    subLabel = (
      <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: GREEN, fontVariantNumeric: 'tabular-nums' }}>
        {counts.orders > 0 ? `${counts.orders.toLocaleString()} ` : ''}
        <Typography component="span" sx={{ fontSize: '0.8rem', color: pal.textSecond, fontWeight: 400 }}>
          {counts.orders > 0 ? 'orders mapped' : 'orders mapped'}
        </Typography>
      </Typography>
    );
  }

  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 1.5,
      animation: 'stepReveal 0.4s ease both',
      '@keyframes stepReveal': {
        from: { opacity: 0, transform: 'translateX(-8px)' },
        to:   { opacity: 1, transform: 'translateX(0)' },
      },
    }}>
      {/* Icon */}
      <Box sx={{
        mt: '3px', flexShrink: 0,
        '@keyframes iconPulse': {
          '0%, 100%': { opacity: 1,    transform: 'scale(1)' },
          '50%':      { opacity: 0.5,  transform: 'scale(0.85)' },
        },
        animation: isActive ? 'iconPulse 1.4s ease-in-out infinite' : 'none',
      }}>
        {isDone
          ? <CheckCircle size={18} color={GREEN} />
          : <Zap size={18} color={ACCENT} />
        }
      </Box>

      {/* Text */}
      <Box sx={{ flex: 1 }}>
        <Typography sx={{
          fontSize: '0.68rem', fontWeight: 700,
          color: isDone ? GREEN : ACCENT,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          transition: 'color 0.3s ease',
        }}>
          {step.label}
        </Typography>

        {subLabel}

        <Typography sx={{ fontSize: '0.72rem', color: pal.textSecond, mt: 0.25, lineHeight: 1.6 }}>
          {step.detail}
        </Typography>
      </Box>
    </Box>
  );
};

// ─── SyncAnimationPage ────────────────────────────────────────────────────────

const SyncAnimationPage: React.FC = () => {
  const { status, counts: polledCounts, progress } = useSyncStatus();
  const { stepStates, activeStepIndex, progressWidth, isError } =
    useSyncStepMachine(status, polledCounts, TOTAL_STEPS, progress);
  const pal = useSyncTheme();

  // Peak count tracking — DB counts lag projections, preserve highest seen value
  const peakVariantsRef = useRef(0);
  const peakOrdersRef   = useRef(0);
  // Track peak from both DB counts AND progress.current (products sync uses progress proxy)
  if (polledCounts.variants > 0) peakVariantsRef.current = Math.max(peakVariantsRef.current, polledCounts.variants);
  if (progress?.current && progress.current > 0) peakVariantsRef.current = Math.max(peakVariantsRef.current, progress.current);
  if (polledCounts.orders > 0) peakOrdersRef.current = Math.max(peakOrdersRef.current, polledCounts.orders);

  // explicit failure state
  if (isError) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: pal.bg }}>
        <Box sx={{ textAlign: 'center', maxWidth: 320, p: 4 }}>
          <Typography sx={{ fontSize: '1.2rem', fontWeight: 700, color: pal.textPrimary, mb: 1 }}>Sync failed</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: pal.textSecond }}>Something went wrong while connecting your store. Please try again.</Typography>
        </Box>
      </Box>
    );
  }

  const currentStepNumber = Math.min(activeStepIndex + 1, TOTAL_STEPS);

  return (

    <Box sx={{ minHeight: 'calc(100vh - 48px)', bgcolor: pal.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── Body ─────────────────────────────────────────────────────── */}
      <Box sx={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr' },
        gap: 0,
        maxWidth: 1100,
        mx: 'auto',
        width: '100%',
        px: { xs: 2, md: 4 },
        py: { xs: 3, md: 5 },
      }}>

        {/* ── LEFT PANEL ──────────────────────────────────────────────── */}
        <Box sx={{ pr: { md: 5 }, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

          {/* Label */}
          <Typography sx={{
            fontSize: '0.65rem', fontWeight: 800,
            color: ACCENT, letterSpacing: '0.14em',
            textTransform: 'uppercase', mb: 1.5,
          }}>
            ● Syncing your rows
          </Typography>

          {/* Headline */}
          <Typography sx={{
            fontSize: { xs: '1.8rem', md: '2.2rem' },
            fontWeight: 700,
            color: pal.textPrimary,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            mb: 0.5,
          }}>
            Building your brief,{' '}
            <Box component="span" sx={{ color: ACCENT, fontStyle: 'italic', fontWeight: 400 }}>
              live.
            </Box>
          </Typography>

          <Typography sx={{ fontSize: '0.85rem', color: pal.textSecond, mb: 4, lineHeight: 1.6 }}>
            Bringing your workflow together.
          </Typography>

          {/* ── Step list — one active at a time ────────────────────── */}
          <Stack spacing={3} sx={{ mb: 4 }}>
            {STEPS.map((step, i) => (
              <StepItem
                key={i}
                step={step}
                state={stepStates[i]}
                stepIndex={i}
                activeIndex={activeStepIndex}
                counts={{ 
                  orders: Math.max(polledCounts.orders, peakOrdersRef.current), 
                  variants: Math.max(polledCounts.variants, peakVariantsRef.current) 
                }}
                progress={i === 1 ? progress : null}
                pal={pal}
              />
            ))}
          </Stack>

          {/* ── Progress bar ────────────────────────────────────────── */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography sx={{ fontSize: '0.68rem', color: pal.textHint }}>
                Step {currentStepNumber} of {TOTAL_STEPS}
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', color: pal.textHint }}>
                {Math.round(progressWidth)}%
              </Typography>
            </Box>
            <Box sx={{ height: 3, borderRadius: 2, bgcolor: pal.border, overflow: 'hidden' }}>
              <Box sx={{
                height: '100%',
                width: `${progressWidth}%`,
                borderRadius: 2,
                background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_HOVER})`,
                transition: 'width 1s cubic-bezier(0.4,0,0.2,1)',
              }} />
            </Box>
          </Box>
        </Box>

      </Box>
    </Box>
  );
};

export default SyncAnimationPage;
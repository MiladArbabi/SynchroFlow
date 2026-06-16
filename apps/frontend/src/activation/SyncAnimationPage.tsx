/* eslint-disable @typescript-eslint/no-unused-vars */
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

// Product-facing step copy: mirrors the website story while backend phases stay unchanged.
const STEPS: StepDef[] = [
  { label: 'Connecting to Shopify', detail: 'Products, variants, orders, and inventory start flowing into LaSyncro' },
  { label: 'Building inventory truth', detail: 'SKUs become warehouse-ready for receive, barcode, stow, pick, pack, and ship' },
  { label: 'Creating Orders Triage', detail: 'Blocked orders surface first, ready orders prepare for batch release' },
  { label: 'Finding operational risk', detail: 'Stock risk, delay risk, and fulfillment issues are flagged before they slow the floor' },
    { label: 'Preparing your Morning Brief', detail: 'Your first action list is built from orders, stock, batches, and warehouse flow' },
];

// ─── Mini warehouse map ────────────────────────────────────────────────────────
// Replaces text-heavy SyncEducationPanel.
// No paragraph copy. Zones activate per sync step. Pulse path animates on SVG.

interface MiniZoneDef {
  id: string;
  label: string;
  sx: Record<string, unknown>;
}

const MINI_ZONES: MiniZoneDef[] = [
  { id: 'po',       label: 'PO',        sx: { left: '7%',  top: '67%', width: '14%', height: '18%' } },
  { id: 'dock',     label: 'Inbound',   sx: { left: '7%',  top: '14%', width: '15%', height: '25%' } },
  { id: 'receive',  label: 'Receive',   sx: { left: '27%', top: '14%', width: '17%', height: '32%' } },
  { id: 'stow',     label: 'Stow',      sx: { left: '48%', top: '14%', width: '17%', height: '32%' } },
  { id: 'shelves',  label: 'Inventory', sx: { left: '35%', top: '54%', width: '30%', height: '32%' } },
  { id: 'orders',   label: 'Orders',    sx: { left: '74%', top: '12%', width: '17%', height: '19%' } },
  { id: 'pack',     label: 'Pack',      sx: { left: '74%', top: '39%', width: '17%', height: '25%' } },
  { id: 'outbound', label: 'Ship',      sx: { left: '70%', top: '74%', width: '23%', height: '16%' } },
];

const MINI_ACTIVE_ZONES: Record<number, string[]> = {
  0: ['po', 'dock'],
  1: ['receive', 'stow', 'shelves'],
  2: ['orders', 'shelves', 'pack'],
  3: ['receive', 'orders', 'pack'],
  4: ['shelves', 'orders', 'pack', 'outbound'],
};

const MINI_PATHS: Record<number, string> = {
  0: 'M70 268 C98 218 120 154 170 126',
  1: 'M210 126 C248 126 274 126 318 126 C354 126 386 148 420 196',
  2: 'M420 196 C498 136 558 90 622 112 C636 164 636 226 622 276',
  3: 'M318 126 C420 78 526 92 622 112 M622 112 C638 174 638 224 622 276',
  4: 'M420 196 C500 228 574 258 622 276 C620 330 604 354 560 358',
};

// All connector paths: rendered dim always, so the floor plan is readable even
// before a step activates a section.
const ALL_CONNECTOR_PATHS = [
  'M70 268 C98 218 120 154 170 126',
  'M210 126 C248 126 274 126 318 126 C354 126 386 148 420 196',
  'M420 196 C498 136 558 90 622 112 C636 164 636 226 622 276',
  'M420 196 C500 228 574 258 622 276 C620 330 604 354 560 358',
];

function SyncEducationPanel({
  activeStepIndex,
  pal,
}: {
  activeStepIndex: number;
  pal: ReturnType<typeof useSyncTheme>;
}) {
  const ZONE_ACCENT = '#D85A30';  // orange — zone fills, labels, parcel
  const BEAM_COLOR  = '#1FA8FF';  // rgba(31,168,255) — exact landing page beam
  const activeZones = MINI_ACTIVE_ZONES[activeStepIndex] ?? [];
  const activePath  = MINI_PATHS[activeStepIndex] ?? '';

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 380,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}
    >
      {/* Grid floor — matches landing page aesthetic */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(31,168,255,0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(31,168,255,0.045) 1px, transparent 1px)
          `,
          backgroundSize: '38px 38px',
          pointerEvents: 'none',
        }}
      />

      {/* SVG layer: connectors + active pulse path + dot */}
      <Box
        component="svg"
        viewBox="0 0 700 400"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
      
      <defs>
          <filter id="beam-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="dot-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Dim connector lines — blue-tinted skeleton, always visible */}
        {ALL_CONNECTOR_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="rgba(93,184,255,0.09)"
            strokeWidth="1.5"
            strokeDasharray="4 5"
          />
        ))}

        {/* Active beam: glowing blue dash — matches landing page */}
        {activePath && (
          <path
            key={`pulse-${activeStepIndex}`}
            d={activePath}
            fill="none"
            stroke={BEAM_COLOR}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="10 6"
            opacity={0.85}
            filter="url(#beam-glow)"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-32"
              dur="0.7s"
              repeatCount="indefinite"
            />
          </path>
        )}

        {/* Moving dot along beam — 3-layer radial match of landing page dot */}
        {activePath && (
          <g>
            <animateMotion
              key={`dot-${activeStepIndex}`}
              dur="1.6s"
              repeatCount="indefinite"
              path={activePath}
            />
            {/* Outer glow — r30, rgba(31,168,255,0.32) */}
            <circle r="22" fill="rgba(31,168,255,0.18)" />
            {/* Inner glow — r11, rgba(120,205,255,0.75) */}
            <circle r="9"  fill="rgba(120,205,255,0.62)" />
            {/* White center — r3 */}
            <circle r="3"  fill="rgba(255,255,255,0.98)" />
          </g>
        )}
      </Box>

      {/* Warehouse zone boxes */}
      {MINI_ZONES.map((zone) => {
        const isActive = activeZones.includes(zone.id);
        return (
          <Box
            key={zone.id}
            sx={{
              position: 'absolute',
              ...zone.sx,
              borderRadius: 1.5,
              border: `1px solid ${isActive ? 'rgba(216,90,48,0.5)' : 'rgba(255,255,255,0.07)'}`,
              background: isActive ? 'rgba(216,90,48,0.14)' : 'rgba(255,255,255,0.04)',
              transition: 'background 0.45s ease, border-color 0.45s ease',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'flex-start',
              p: 0.75,
              overflow: 'hidden',
            }}
          >
            {/* Shelf slots inside Inventory zone */}
            {zone.id === 'shelves' && (
              <Box
                sx={{
                  position: 'absolute',
                  top: '15%',
                  left: '6%',
                  right: '6%',
                  height: '52%',
                  display: 'flex',
                  gap: '5%',
                }}
              >
                {[0, 1, 2, 3].map((i) => (
                  <Box
                    key={i}
                    sx={{
                      flex: 1,
                      borderRadius: 0.5,
                      background: isActive
                        ? 'rgba(216,90,48,0.28)'
                        : 'rgba(255,255,255,0.06)',
                      transition: 'background 0.45s ease',
                    }}
                  />
                ))}
              </Box>
            )}

            {/* Parcel box inside Pack zone when active */}
            {zone.id === 'pack' && isActive && (
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 16,
                  height: 16,
                  borderRadius: 1,
                  background: ZONE_ACCENT,
                  opacity: 0.65,
                }}
              />
            )}

            {/* Zone label */}
            <Typography
              sx={{
                fontSize: '0.58rem',
                fontWeight: 700,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: isActive ? ZONE_ACCENT : 'rgba(255,255,255,0.22)',
                transition: 'color 0.45s ease',
                lineHeight: 1,
                position: 'relative',
                zIndex: 1,
              }}
            >
              {zone.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

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
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
          },
          gap: { xs: 4, sm: 5, md: 6 },
          alignItems: 'center',
          maxWidth: 1180,
          mx: 'auto',
          width: '100%',
          px: { xs: 2, md: 4 },
          py: { xs: 3, md: 5 },
        }}>

        {/* ── LEFT PANEL ──────────────────────────────────────────────── */}
        <Box sx={{ pr: { md: 5 }, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

          {/* Product-facing OAuth state: keep this copy aligned with landing-page ABT story. */}
          <Typography sx={{
            fontSize: '0.65rem', fontWeight: 800,
            color: ACCENT, letterSpacing: '0.14em',
            textTransform: 'uppercase', mb: 1.5,
          }}>
            ● Connecting your operation
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
            Building your LaSyncro workspace,{' '}
            <Box component="span" sx={{ color: ACCENT, fontStyle: 'italic', fontWeight: 400 }}>
              live.
            </Box>
          </Typography>

          <Typography sx={{ fontSize: '0.85rem', color: pal.textSecond, mb: 4, lineHeight: 1.6 }}>
            Turning your Shopify data into inventory truth, orders triage, warehouse flow, and your first Morning Brief.
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
        
        {/* ── RIGHT PANEL — product education during OAuth sync ───────── */}
          <SyncEducationPanel activeStepIndex={activeStepIndex} pal={pal} />

        </Box>
      </Box>
  );
};

export default SyncAnimationPage;
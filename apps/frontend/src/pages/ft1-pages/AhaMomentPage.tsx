/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft1-pages/AhaMomentPage.tsx
//
// PURPOSE:
// FT1 Aha moment — the first personalised insight a merchant sees
// after sync completes. Shown at /overview during FT1.
//
// ARCHITECTURE:
// - Fetches /api/v1/aha/signal on mount — 6-signal priority cascade.
// - Renders the winning signal with headline, detail, and 3 supporting cards.
// - Single CTA: "Unlock Insights" → calls confirmFt2() → lifecycle polling
//   flips to FT2_READY → LifecycleRouteHost unmounts this and mounts FT2.
//
// THEME: uses useColorScheme() — matches codebase convention (MainCard.tsx).
//
// RULES:
// - No lifecycle reads (mount/unmount is handled by LifecycleRouteHost)
// - No routing decisions
// - No module-level data fetching
// - Pure signal renderer + FT2 promotion trigger

import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { TrendingUp, AlertTriangle, Users, Clock, CheckCircle, ArrowRight } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { getFt2Readiness, confirmFt2 } from 'api/lifecycle';
import { ThemeMode } from 'config';

// ─── Brand tokens ─────────────────────────────────────────────────────────────

const ACCENT       = '#FF6B2B';
const ACCENT_HOVER = '#FF8C5A';
const ACCENT_GHOST = 'rgba(255, 107, 43, 0.10)';
const ACCENT_BORDER= 'rgba(255, 107, 43, 0.25)';
const GREEN        = '#22C55E';
const GREEN_GHOST  = 'rgba(34, 197, 94, 0.10)';

// ─── Theme ────────────────────────────────────────────────────────────────────

function useAhaTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === ThemeMode.DARK;
  return {
    isDark,
    bg:          isDark ? '#151D29' : '#F8F9FA',
    surface:     isDark ? '#1C2740' : '#FFFFFF',
    surfaceAlt:  isDark ? '#243050' : '#F3F2EF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    textHint:    isDark ? '#5A5F6E' : '#9CA3AF',
    shadow:      isDark ? '0 24px 64px rgba(0,0,0,0.4)' : '0 8px 32px rgba(0,0,0,0.10)',
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AhaSupportingCard {
  label: string;
  value: string;
  sublabel?: string;
}

interface AhaSignal {
  priority: 1 | 2 | 3 | 4 | 6;
  headline: string;
  detail: string;
  revenueImpact: number | null;
  cards: AhaSupportingCard[];
  deepLink: string;
  ctaLabel: string;
}

interface AhaSignalResponse {
  signal: AhaSignal;
  evaluatedAt: string;
}

// ─── Priority → icon + color ──────────────────────────────────────────────────

function getPriorityVisual(priority: AhaSignal['priority']) {
  switch (priority) {
    case 1: return { icon: AlertTriangle, color: '#EF4444', bg: 'rgba(239,68,68,0.10)', label: 'Highest urgency' };
    case 2: return { icon: Clock,         color: '#F59E0B', bg: 'rgba(245,158,11,0.10)', label: 'Urgent' };
    case 3: return { icon: Users,         color: '#8B5CF6', bg: 'rgba(139,92,246,0.10)', label: 'Strategic' };
    case 4: return { icon: TrendingUp,    color: ACCENT,    bg: ACCENT_GHOST,             label: 'Operational' };
    case 6: return { icon: CheckCircle,   color: GREEN,     bg: GREEN_GHOST,              label: 'Healthy' };
  }
}

// ─── SupportingCard ───────────────────────────────────────────────────────────

const SupportingCard: React.FC<{ card: AhaSupportingCard; pal: ReturnType<typeof useAhaTheme> }> = ({ card, pal }) => (
  <Box
    sx={{
      flex: 1,
      minWidth: 0,
      p: 2,
      borderRadius: '10px',
      backgroundColor: pal.surfaceAlt,
      border: `1px solid ${pal.border}`,
    }}
  >
    <Typography sx={{ fontSize: '0.68rem', color: pal.textHint, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', mb: 0.5 }}>
      {card.label}
    </Typography>
    <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: pal.textPrimary, letterSpacing: '-0.02em', lineHeight: 1 }}>
      {card.value}
    </Typography>
    {card.sublabel && (
      <Typography sx={{ fontSize: '0.7rem', color: pal.textSecond, mt: 0.5 }}>
        {card.sublabel}
      </Typography>
    )}
  </Box>
);

// ─── AhaMomentPage ───────────────────────────────────────────────────────────

const AhaMomentPage: React.FC = () => {
  const pal = useAhaTheme();

  const [signal, setSignal]       = useState<AhaSignal | null>(null);
  const [loading, setLoading]     = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Fetch Aha signal on mount
  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      try {
        const { data } = await axiosInstance.get<AhaSignalResponse>('/api/v1/aha/signal');
        if (!cancelled) setSignal(data.signal);
      } catch (err) {
        if (!cancelled) setError('Could not load your signal. Please refresh.');
        console.error('[AhaMomentPage] signal fetch failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetch();
    return () => { cancelled = true; };
  }, []);

  /**
   * handleUnlock — FT2 promotion flow.
   * Mirrors Ft1Outlet.tsx pattern exactly:
   *   1. Check readiness
   *   2. Confirm FT2
   *   3. Wait for lifecycle polling to flip to FT2_READY
   *   LifecycleRouteHost handles unmount automatically.
   */
  const handleUnlock = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      const readiness = await getFt2Readiness();
      if (!readiness.ready) {
        console.warn('[AhaMomentPage] FT2 not ready yet', readiness);
        setConfirming(false);
        return;
      }
      await confirmFt2();
      // Lifecycle polling takes over — no manual navigation needed
      console.info('[AhaMomentPage] FT2 confirm requested — waiting for poll');
    } catch (err) {
      console.error('[AhaMomentPage] FT2 confirm failed', err);
      setConfirming(false);
    }
  };

  const visual = signal ? getPriorityVisual(signal.priority) : null;
  const SignalIcon = visual?.icon;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pal.bg,
        px: 2,
        py: 4,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 560 }}>

        {/* Loading */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress sx={{ color: ACCENT }} />
          </Box>
        )}

        {/* Error */}
        {error && !loading && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography sx={{ color: pal.textSecond }}>{error}</Typography>
          </Box>
        )}

        {/* Signal */}
        {signal && visual && SignalIcon && (
          <Box
            sx={{
              backgroundColor: pal.surface,
              borderRadius: '16px',
              border: `1px solid ${pal.border}`,
              boxShadow: pal.shadow,
              overflow: 'hidden',
            }}
          >
            {/* Priority badge bar */}
            <Box
              sx={{
                px: 3,
                py: 1.25,
                backgroundColor: visual.bg,
                borderBottom: `1px solid ${pal.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <SignalIcon size={14} color={visual.color} />
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: visual.color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {visual.label}
              </Typography>
              {signal.revenueImpact && (
                <Typography sx={{ fontSize: '0.68rem', color: pal.textHint, ml: 'auto' }}>
                  ${Math.round(signal.revenueImpact).toLocaleString()} at stake
                </Typography>
              )}
            </Box>

            {/* Body */}
            <Box sx={{ p: { xs: 3, sm: 4 } }}>

              {/* Eyebrow */}
              <Typography
                sx={{
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  color: ACCENT,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  mb: 1,
                }}
              >
                LaSyncro found this in your store
              </Typography>

              {/* Headline */}
              <Typography
                sx={{
                  fontSize: { xs: '1.4rem', sm: '1.75rem' },
                  fontWeight: 800,
                  color: pal.textPrimary,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.15,
                  mb: 1.5,
                }}
              >
                {signal.headline}
              </Typography>

              {/* Detail */}
              <Typography
                sx={{
                  fontSize: '0.9rem',
                  color: pal.textSecond,
                  lineHeight: 1.6,
                  mb: 3,
                }}
              >
                {signal.detail}
              </Typography>

              {/* Supporting cards */}
              <Box
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  mb: 3.5,
                  flexWrap: 'wrap',
                }}
              >
                {signal.cards.map((card, i) => (
                  <SupportingCard key={i} card={card} pal={pal} />
                ))}
              </Box>

              {/* Divider */}
              <Box sx={{ borderTop: `1px solid ${pal.border}`, mb: 3 }} />

              {/* Unlock CTA */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                <Button
                  fullWidth
                  variant="contained"
                  disabled={confirming}
                  onClick={handleUnlock}
                  endIcon={confirming ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <ArrowRight size={16} />}
                  sx={{
                    backgroundColor: ACCENT,
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '1rem',
                    py: 1.5,
                    borderRadius: '10px',
                    textTransform: 'none',
                    letterSpacing: '-0.01em',
                    '&:hover': { backgroundColor: ACCENT_HOVER },
                    '&:disabled': { backgroundColor: ACCENT, opacity: 0.7 },
                  }}
                >
                  {confirming ? 'Unlocking…' : 'Unlock Insights'}
                </Button>

                <Typography sx={{ fontSize: '0.72rem', color: pal.textHint, textAlign: 'center' }}>
                  {signal.priority === 6
                    ? 'Set up your Morning Brief and track your operation daily.'
                    : 'Unlock to see the full picture — and what to do about it.'}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default AhaMomentPage;
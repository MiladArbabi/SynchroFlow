// apps/frontend/src/pages/ft1-pages/AhaMomentPage.tsx
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
const GREEN_BORDER = 'rgba(34, 197, 94, 0.25)';

// ─── Theme ────────────────────────────────────────────────────────────────────

function useAhaTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === ThemeMode.DARK;
  return {
    isDark,
    bg:          isDark ? '#0F1520' : '#F3F2EF',
    surface:     isDark ? '#1A2236' : '#FFFFFF',
    surfaceAlt:  isDark ? '#212D45' : '#F8F7F4',
    border:      isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    borderStrong:isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.14)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#7A8090' : '#6B7280',
    textHint:    isDark ? '#4A5060' : '#9CA3AF',
    shadow:      isDark
      ? '0 0 0 1px rgba(255,255,255,0.06), 0 24px 64px rgba(0,0,0,0.5)'
      : '0 0 0 1px rgba(0,0,0,0.06), 0 8px 40px rgba(0,0,0,0.08)',
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
    case 1: return { icon: AlertTriangle, color: '#EF4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.20)', label: 'Needs attention' };
    case 2: return { icon: Clock,         color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.20)', label: 'Urgent' };
    case 3: return { icon: Users,         color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.20)', label: 'Strategic' };
    case 4: return { icon: TrendingUp,    color: ACCENT,    bg: ACCENT_GHOST,             border: ACCENT_BORDER,           label: 'Operational' };
    case 6: return { icon: CheckCircle,   color: GREEN,     bg: GREEN_GHOST,              border: GREEN_BORDER,            label: 'Healthy' };
  }
}

// ─── SupportingCard ───────────────────────────────────────────────────────────

const SupportingCard: React.FC<{
  card: AhaSupportingCard;
  pal: ReturnType<typeof useAhaTheme>;
  accent?: string;
}> = ({ card, pal, accent }) => (
  <Box
    sx={{
      flex: 1,
      minWidth: 0,
      p: '14px 16px',
      borderRadius: '10px',
      backgroundColor: pal.surfaceAlt,
      border: `1px solid ${pal.border}`,
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      transition: 'border-color 0.15s',
    }}
  >
    <Typography sx={{
      fontSize: '0.62rem',
      color: pal.textHint,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      mb: 0.75,
    }}>
      {card.label}
    </Typography>
    <Typography sx={{
      fontSize: '1.5rem',
      fontWeight: 800,
      color: pal.textPrimary,
      letterSpacing: '-0.03em',
      lineHeight: 1,
      fontVariantNumeric: 'tabular-nums',
    }}>
      {card.value}
    </Typography>
    {card.sublabel && (
      <Typography sx={{ fontSize: '0.68rem', color: pal.textSecond, mt: 0.75, lineHeight: 1.3 }}>
        {card.sublabel}
      </Typography>
    )}
  </Box>
);

// ─── AhaMomentPage ───────────────────────────────────────────────────────────

const AhaMomentPage: React.FC = () => {
  const pal = useAhaTheme();

  const [signal, setSignal]         = useState<AhaSignal | null>(null);
  const [evaluatedAt, setEvaluatedAt] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      try {
        const { data } = await axiosInstance.get<AhaSignalResponse>('/api/v1/aha/signal');
        if (!cancelled) {
          setSignal(data.signal);
          setEvaluatedAt(data.evaluatedAt);
        }
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
      console.info('[AhaMomentPage] FT2 confirm requested — waiting for poll');
    } catch (err) {
      console.error('[AhaMomentPage] FT2 confirm failed', err);
      setConfirming(false);
    }
  };

  const visual = signal ? getPriorityVisual(signal.priority) : null;
  const SignalIcon = visual?.icon;

  // Formatted timestamp
  const timeLabel = evaluatedAt
    ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(evaluatedAt))
    : null;

  return (
    <Box
      sx={{
        minHeight: 'calc(100vh - 48px)',
        display: 'flex',
        alignItems: 'flex-start',
        pt: '10vh',
        justifyContent: 'center',
        backgroundColor: pal.bg,
        px: 2,
        py: 5,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 600 }}>

        {/* Loading */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress sx={{ color: ACCENT }} size={28} />
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
          <>
            {/* Status pill — above card */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 2.5 }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.5,
                  py: 0.625,
                  borderRadius: '999px',
                  backgroundColor: visual.bg,
                  border: `1px solid ${visual.border}`,
                }}
              >
                <SignalIcon size={13} color={visual.color} />
                <Typography sx={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: visual.color,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}>
                  {visual.label}
                </Typography>
              </Box>
              {timeLabel && (
                <Typography sx={{ fontSize: '0.68rem', color: pal.textHint }}>
                  as of {timeLabel}
                </Typography>
              )}
            </Box>

            {/* Main card */}
            <Box
              sx={{
                backgroundColor: pal.surface,
                borderRadius: '16px',
                border: `1px solid ${pal.border}`,
                boxShadow: pal.shadow,
                overflow: 'hidden',
              }}
            >
              {/* Body */}
              <Box sx={{ p: { xs: '28px 24px', sm: '36px 40px' } }}>

                {/* Eyebrow */}
                <Typography sx={{
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  color: ACCENT,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  mb: 1.25,
                }}>
                  LaSyncro found this in your store
                </Typography>

                {/* Headline */}
                <Typography sx={{
                  fontSize: { xs: '1.5rem', sm: '1.9rem' },
                  fontWeight: 800,
                  color: pal.textPrimary,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.12,
                  mb: 1.5,
                }}>
                  {signal.headline}
                </Typography>

                {/* Detail */}
                <Typography sx={{
                  fontSize: '0.9rem',
                  color: pal.textSecond,
                  lineHeight: 1.65,
                  mb: 3.5,
                  maxWidth: 460,
                }}>
                  {signal.detail}
                </Typography>

                {/* Supporting cards */}
                <Box sx={{ display: 'flex', gap: 1.5, mb: 4, flexWrap: 'wrap' }}>
                  {signal.cards.map((card, i) => (
                    <SupportingCard
                      key={i}
                      card={card}
                      pal={pal}
                      accent={i === 0 ? visual.color : undefined}
                    />
                  ))}
                </Box>

                {/* Divider + revenue — only when revenueImpact present */}
                {Boolean(signal.revenueImpact) && (
                  <>
                  <Box sx={{ borderTop: `1px solid ${pal.border}`, mb: 3.5 }} />
                  <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 2.5,
                    px: 2,
                    py: 1.25,
                    borderRadius: '8px',
                    backgroundColor: ACCENT_GHOST,
                    border: `1px solid ${ACCENT_BORDER}`,
                  }}>
                    <TrendingUp size={14} color={ACCENT} />
                    <Typography sx={{ fontSize: '0.8rem', color: ACCENT, fontWeight: 600 }}>
                      ${Math.round(signal.revenueImpact).toLocaleString()} potential impact identified
                    </Typography>
                  </Box>
                </>
                )}

                {/* Unlock CTA */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    disabled={confirming}
                    onClick={handleUnlock}
                    endIcon={
                      confirming
                        ? <CircularProgress size={15} sx={{ color: '#fff' }} />
                        : <ArrowRight size={15} />
                    }
                    sx={{
                      backgroundColor: ACCENT,
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: '0.95rem',
                      py: 1.625,
                      borderRadius: '10px',
                      textTransform: 'none',
                      letterSpacing: '-0.01em',
                      boxShadow: `0 4px 16px ${ACCENT_GHOST}`,
                      '&:hover': {
                        backgroundColor: ACCENT_HOVER,
                        boxShadow: `0 6px 20px rgba(255,107,43,0.30)`,
                      },
                      '&:disabled': { backgroundColor: ACCENT, opacity: 0.65, boxShadow: 'none' },
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
          </>
        )}
      </Box>
    </Box>
  );
};

export default AhaMomentPage;
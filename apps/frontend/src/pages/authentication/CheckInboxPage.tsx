// apps/frontend/src/pages/authentication/CheckInboxPage.tsx
//
// AUTH-007: A5 — Check your inbox (email verification)
// Shown after email/password registration.
// Dual-purpose: also used as forgot-password confirmation state.
//
// Matches target design A5:
// - Envelope icon
// - "Check your inbox." headline
// - Email address shown
// - Link expires in 30 minutes
// - Resend + Change address actions
// - "Wrong account? Sign out"
//
import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from 'contexts/AuthContext';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AuthWrapper1 from './AuthWrapper1';
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';
import MarkEmailUnreadOutlinedIcon from '@mui/icons-material/MarkEmailUnreadOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import MailOutlineIcon from '@mui/icons-material/MailOutline';

export default function CheckInboxPage() {
  const { user, logout, accessToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Email can come from auth state or location state (forgot-password flow)
  // Email from auth state, location state, or localStorage fallback
  const storedUser = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') ?? '{}'); } catch { return {}; }
  }, []);
  const email = user?.email ?? (location.state as { email?: string })?.email ?? storedUser?.email ?? '';

  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendCooldown, setResendCooldown] = useState(false);

  const handleResend = async () => {
    if (resendCooldown) return;
    setResendState('sending');
    try {
      await axiosInstance.post('/api/v1/auth/resend-verification', {}, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setResendState('sent');
      setResendCooldown(true);
      // Re-enable after 60s
      setTimeout(() => {
        setResendCooldown(false);
        setResendState('idle');
      }, 60_000);
    } catch {
      setResendState('error');
    }
  };

  // #982: listen for verification success from other tabs (BroadcastChannel)
  React.useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('lasyncro_auth');
      bc.onmessage = (e) => {
        if (e.data?.type === 'EMAIL_VERIFIED') {
          navigate('/connect-store?verified=true');
        }
      };
    } catch { /* BroadcastChannel not supported */ }
    return () => bc?.close();
  }, [navigate]);

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>

        {/* Nav bar */}
        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <Link to="/" aria-label="LaSyncro home">
            <Box component="img" src="/logo-dark.png" alt="LaSyncro" sx={{ height: 28, width: 'auto' }} />
          </Link>
          <SystemStatusPill />
        </Box>

        {/* Card */}
        <Box sx={{ width: '100%', maxWidth: 480, mx: 'auto', px: { xs: 2, sm: 3 } }}>
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 3, p: { xs: 3, sm: 4 }, textAlign: 'center' }}>

            {/* Envelope icon */}
            <Box sx={{
              width: 64, height: 64, borderRadius: 2.5,
              bgcolor: 'var(--accent-ghost)', border: '1px solid var(--accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              mx: 'auto', mb: 3,
            }}>
              <MarkEmailUnreadOutlinedIcon sx={{ color: 'var(--accent)', fontSize: 32 }} />
            </Box>

            {/* Label */}
            <Typography variant="caption" sx={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.7rem', display: 'block', mb: 1 }}>
              Verify email
            </Typography>

            {/* Headline — matches target A5 */}
            <Typography variant="h2" sx={{ color: 'var(--ink)', fontWeight: 700, mb: 1.5 }}>
              Check your inbox.
            </Typography>

            <Typography variant="body2" sx={{ color: 'var(--ink-3)', mb: 0.5 }}>
              We sent a verification link to
            </Typography>
            <Typography variant="body2" sx={{ color: 'var(--ink)', fontWeight: 600, mb: 3 }}>
              {email}
            </Typography>

            {/* Expiry notice — matches target A5 */}
            <Box sx={{ bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', borderRadius: 2, p: 2, mb: 3, textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Typography sx={{ fontSize: '1rem', mt: 0.1 }}>⏱</Typography>
              <Box>
                <Typography variant="body2" sx={{ color: 'var(--ink)', fontWeight: 600 }}>
                  The link expires in 30 minutes
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--ink-3)' }}>
                  Don't see it? Check spam, or resend below.
                </Typography>
              </Box>
            </Box>

            {/* Actions — matches target A5 */}
            {(() => {
              const domain = email.split('@')[1]?.toLowerCase() ?? '';
              const providerMap: Record<string, { label: string; url: string }> = {
                'gmail.com':       { label: 'Open Gmail',   url: 'https://mail.google.com' },
                'googlemail.com':  { label: 'Open Gmail',   url: 'https://mail.google.com' },
                'outlook.com':     { label: 'Open Outlook', url: 'https://outlook.live.com/mail' },
                'hotmail.com':     { label: 'Open Outlook', url: 'https://outlook.live.com/mail' },
                'live.com':        { label: 'Open Outlook', url: 'https://outlook.live.com/mail' },
                'yahoo.com':       { label: 'Open Yahoo Mail', url: 'https://mail.yahoo.com' },
                'ymail.com':       { label: 'Open Yahoo Mail', url: 'https://mail.yahoo.com' },
                'icloud.com':      { label: 'Open iCloud Mail', url: 'https://www.icloud.com/mail' },
                'me.com':          { label: 'Open iCloud Mail', url: 'https://www.icloud.com/mail' },
              };
              const provider = providerMap[domain] ?? { label: 'Open email app', url: `https://${domain}` };
              return (
                <Button
                  fullWidth
                  variant="contained"
                  href={provider.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    mb: 1.5,
                    bgcolor: 'var(--accent)',
                    color: '#fff',
                    fontWeight: 700,
                    textTransform: 'none',
                    fontSize: '0.9rem',
                    py: 1.25,
                    borderRadius: '8px',
                    '&:hover': { bgcolor: 'var(--accent-hover)' },
                  }}
                >
                  {provider.label} →
                </Button>
              );
            })()}
            <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
              <Button
                fullWidth
                variant="outlined"
                onClick={handleResend}
                disabled={resendState === 'sending' || resendCooldown}
                sx={{ border: '1px solid var(--rule-2)', color: 'var(--ink-2)', '&:hover': { bgcolor: 'var(--bg-2)' }, textTransform: 'none' }}
              >
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <RefreshIcon sx={{ fontSize: 16 }} />
                  <span>{resendState === 'sending' ? 'Sending...' : resendState === 'sent' ? 'Sent ✓' : 'Resend email'}</span>
                </Stack>
              </Button>
              <Button
                fullWidth
                variant="outlined"
                component={Link}
                to="/login"
                sx={{ border: '1px solid var(--rule-2)', color: 'var(--ink-2)', '&:hover': { bgcolor: 'var(--bg-2)' }, textTransform: 'none' }}
              >
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <MailOutlineIcon sx={{ fontSize: 16 }} />
                  <span>Change address</span>
                </Stack>
              </Button>
            </Stack>

            {resendState === 'error' && (
              <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mb: 1 }}>
                Failed to resend. Please try again.
              </Typography>
            )}

            {/* Wrong account escape — matches target A5 */}
            <Typography variant="caption" sx={{ color: 'var(--ink-4)' }}>
              Wrong account?{' '}
              <Box
                component="span"
                onClick={handleSignOut}
                sx={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}
              >
                Sign out
              </Box>
            </Typography>

          </Box>
        </Box>

        <SocialProofTicker />
      </Stack>
    </AuthWrapper1>
  );
}
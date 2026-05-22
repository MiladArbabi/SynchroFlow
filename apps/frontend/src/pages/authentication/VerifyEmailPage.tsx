// apps/frontend/src/pages/authentication/VerifyEmailPage.tsx
//
// AUTH-007: Handles the verify-email link clicked from inbox.
// Calls backend GET /api/v1/auth/verify-email?token=...
// Backend redirects to /connect-store?verified=true on success.
// This component handles the case where the backend redirect lands
// back on the frontend — shows status while the redirect happens.
//
import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import AuthWrapper1 from './AuthWrapper1';
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';
import { Link } from 'react-router-dom';

type State = 'verifying' | 'success' | 'expired' | 'invalid' | 'error';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>('verifying');

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }

    // Call backend directly — backend will redirect on success
    // but since we're a SPA, we handle it here instead
    axiosInstance.get(`/api/v1/auth/verify-email`, { params: { token } })
      .then(() => {
        setState('success');
        setTimeout(() => navigate('/connect-store?verified=true'), 1500);
      })
      .catch((err) => {
        const msg = err.response?.data?.error ?? '';
        if (msg.includes('expired')) {
          setState('expired');
        } else if (msg.includes('Invalid') || msg.includes('already')) {
          // Already verified — just proceed
          setState('success');
          setTimeout(() => navigate('/connect-store?verified=already'), 1500);
        } else {
          setState('error');
        }
      });
  }, [navigate, token]);

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh', overflowY: 'auto', pt: '80px', pb: '60px' }}>

        {/* Nav bar */}
        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <Link to="/" aria-label="LaSyncro home">
            <Box component="img" src="/logo-dark.png" alt="LaSyncro" sx={{ height: 28, width: 'auto' }} />
          </Link>
          <SystemStatusPill />
        </Box>

        <Box sx={{ width: '100%', maxWidth: 480, mx: 'auto', px: { xs: 2, sm: 3 } }}>
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 3, p: { xs: 3, sm: 4 }, textAlign: 'center' }}>

            {state === 'verifying' && (
              <Stack spacing={2} alignItems="center">
                <CircularProgress sx={{ color: 'var(--accent)' }} />
                <Typography variant="body1" sx={{ color: 'var(--ink-2)' }}>
                  Verifying your email...
                </Typography>
              </Stack>
            )}

            {state === 'success' && (
              <Stack spacing={2} alignItems="center">
                <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: 'rgba(74,222,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: '1.5rem' }}>✓</Typography>
                </Box>
                <Typography variant="h3" sx={{ color: 'var(--ink)', fontWeight: 700 }}>
                  Email verified!
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--ink-3)' }}>
                  Taking you to connect your store...
                </Typography>
                <CircularProgress size={20} sx={{ color: 'var(--accent)' }} />
              </Stack>
            )}

            {state === 'expired' && (
              <Stack spacing={2} alignItems="center">
                <Typography variant="h3" sx={{ color: 'var(--ink)', fontWeight: 700 }}>
                  Link expired
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--ink-3)' }}>
                  This verification link has expired. Go back to request a new one.
                </Typography>
                <Button
                  component={Link}
                  to="/check-inbox"
                  variant="contained"
                  sx={{ bgcolor: 'var(--accent)', color: '#fff', '&:hover': { bgcolor: 'var(--accent-hover)' } }}
                >
                  Back to inbox check
                </Button>
              </Stack>
            )}

            {(state === 'invalid' || state === 'error') && (
              <Stack spacing={2} alignItems="center">
                <Typography variant="h3" sx={{ color: 'var(--ink)', fontWeight: 700 }}>
                  Invalid link
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--ink-3)' }}>
                  This verification link is invalid or has already been used.
                </Typography>
                <Button
                  component={Link}
                  to="/login"
                  variant="contained"
                  sx={{ bgcolor: 'var(--accent)', color: '#fff', '&:hover': { bgcolor: 'var(--accent-hover)' } }}
                >
                  Go to sign in
                </Button>
              </Stack>
            )}

          </Box>
        </Box>

        <SocialProofTicker />
      </Stack>
    </AuthWrapper1>
  );
}
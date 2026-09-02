/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/authentication/LoginPage.tsx
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import React from 'react';
import { Theme } from '@mui/material/styles';

import useMediaQuery from '@mui/material/useMediaQuery';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

// Analytics
import { usePostHog } from 'posthog-js/react';

// project imports
import AuthWrapper1 from './AuthWrapper1';
import AuthCardWrapper from './AuthCardWrapper';
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';
import { AuthLogo } from './AuthLogo';
import { useAuth } from 'contexts/AuthContext';
import { AuthGridBackdrop } from './AuthGridBackdrop';
// AUTH-LOGOUT-HANG-01: the JWT form is the only live login provider and /login
// is a recovery-critical route. It is imported statically so logout → /login
// never depends on a late lazy chunk (a superseded-deploy chunk 404 previously
// stranded the form slot on a spinner until a manual reload).
import AuthLogin from './jwt/AuthLogin';

// import { APP_AUTH } from 'config';

// ================================|| AUTH3 - LOGIN ||================================ //

export default function Login() {
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();

  /**
   * AUTH-017: LOGGED-IN REDIRECT
   * ─────────────────────────────
   * If a user navigates to /login while already authenticated
   * (back button, stale bookmark, direct URL), send them to /overview
   * instead of showing the login form.
   *
   * Must run before any render to avoid flashing the login UI.
   * sessionStorage.returnTo takes precedence — if they were redirected
   * here from a protected route, honour that destination.
   */
  React.useEffect(() => {
    if (isLoggedIn) {
      const returnTo = sessionStorage.getItem('returnTo');
      sessionStorage.removeItem('returnTo');
      navigate(returnTo && returnTo !== '/login' ? returnTo : '/overview', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  const downMD = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));

  const [searchParams] = useSearchParams();
  const authParam = searchParams.get('auth') || '';
  const posthog = usePostHog();

  return (
    <AuthWrapper1>
      <AuthGridBackdrop />
        <Stack sx={{ justifyContent: 'center', minHeight: '100vh', overflowY: 'auto', pt: '80px', pb: '100px' }}>
          <Stack sx={{ justifyContent: 'center', alignItems: 'center' }}>
            {/* AUTH-012: top-left logo nav bar — matches target A1 */}
            <Box
              sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                px: 3,
                py: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                zIndex: 10,
              }}
            >
              <Link to="/" aria-label="LaSyncro home">
                <AuthLogo />
              </Link>
              {/* AUTH-014: system status pill — top-right */}
              <SystemStatusPill />
            </Box>

            <Box sx={{ width: '100%', boxSizing: 'border-box', px: { xs: 3, sm: 0 } }}>
              <AuthCardWrapper>
                <Stack sx={{ alignItems: 'center', justifyContent: 'center', gap: 2.25 }}>
                  <Stack sx={{ alignItems: 'flex-start', justifyContent: 'center', gap: 1, width: '100%' }}>
                    {/* AUTH-003: concise branded sign-in headline */}
                    <Typography variant={downMD ? 'h3' : 'h2'} sx={{ color: 'var(--ink)', fontWeight: 700 }}>
                      Hello.{' '}
                      {/* Plus Jakarta Sans italic — consistent font across all LaSyncro surfaces */}
                      <Box component="span" sx={{ color: 'var(--accent)', fontStyle: 'italic', fontWeight: 600 }}>
                        Let's sync up.
                      </Box>
                    </Typography>
                    <Typography variant="caption" sx={{ fontSize: '16px', textAlign: { xs: 'center', md: 'inherit' } }}>
                      Sign in to continue to today's brief.
                    </Typography>
                  </Stack>
                  <Box sx={{ width: 1 }}>
                    <AuthLogin posthog={posthog} />
                  </Box>
                  <Divider sx={{ width: 1 }} />
                  <Stack sx={{ alignItems: 'center' }}>
                    {/* AUTH-015: full sentence with accented CTA link */}
                    <Typography variant="subtitle1" sx={{ color: 'var(--ink-3)' }}>
                      New to LaSyncro?{' '}
                      <Box
                        component={Link}
                        to={authParam ? `/register?auth=${authParam}` : '/register'}
                        sx={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                      >
                        Create an account
                      </Box>
                    </Typography>
                  </Stack>
                </Stack>
              </AuthCardWrapper>
            </Box>
          </Stack>
        </Stack>
      {/* AUTH-013: social proof ticker — bottom */}
      <SocialProofTicker />
    </AuthWrapper1>
  );
}
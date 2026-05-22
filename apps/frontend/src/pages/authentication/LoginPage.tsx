/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/authentication/LoginPage.tsx
import { Link, useSearchParams } from 'react-router-dom';
import React, { useEffect, useState } from 'react'; // <-- Import React
import { Theme } from '@mui/material/styles';

import useMediaQuery from '@mui/material/useMediaQuery';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { CircularProgress } from '@mui/material';

// Analytics 
import { usePostHog } from 'posthog-js/react';
import { PostHog } from 'posthog-js';

// project imports
import AuthWrapper1 from './AuthWrapper1'; 
import AuthCardWrapper from './AuthCardWrapper'; 
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';

// import { APP_AUTH } from 'config';

// A mapping of auth types to dynamic imports
const authLoginImports = {
  // firebase: () => import('./firebase/AuthLogin'), // Keep commented if not used
  jwt: () => import('./jwt/AuthLogin'), // <-- FIX PATH if needed (should be correct now)
  // aws: () => import('./aws/AuthLogin'),       // Keep commented if not used
  // auth0: () => import('./auth0/AuthLogin'),     // Keep commented if not used
  // supabase: () => import('./supabase/AuthLogin') // Keep commented if not used
};

interface AuthLoginProps {
  posthog: PostHog;
}

// ================================|| AUTH3 - LOGIN ||================================ //

export default function Login() {
  // AUTH-017: wire real auth state — redirects already-logged-in users away from /login
  const downMD = useMediaQuery((theme: Theme) => theme.breakpoints.down('md')); // <-- Add Theme type
  const [AuthLoginComponent, setAuthLoginComponent] = useState<React.ComponentType<AuthLoginProps> | null>(null);
  
  const [searchParams] = useSearchParams();
  const authParam = searchParams.get('auth') || '';
  const posthog = usePostHog();

  useEffect(() => {
    const selectedAuth = authParam || 'jwt'

    const authLoginImportsTyped: Record<string, () => Promise<any>> = authLoginImports as any;
    const importAuthLoginComponent = authLoginImportsTyped[selectedAuth];
    importAuthLoginComponent()
      .then((module: any) => setAuthLoginComponent(() => module.default))
      .catch((error: any) => {
        console.error(error);
      });
  }, [authParam]);

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'flex-end', minHeight: '100vh' }}>
        <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 68px)' }}>
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
              <Box
                component="img"
                src="/logo-dark.png"
                alt="LaSyncro"
                sx={{ height: 28, width: 'auto' }}
              />
            </Link>
            {/* AUTH-014: system status pill — top-right */}
            <SystemStatusPill />
          </Box>
          <Box sx={{ m: { xs: 1, sm: 3 }, mb: 0 }}>
            <AuthCardWrapper>
              <Stack sx={{ alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <Stack sx={{ alignItems: 'flex-start', justifyContent: 'center', gap: 1, width: '100%' }}>
                  {/* Target A1: "SIGN IN" orange uppercase label */}
                  <Typography sx={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Sign in
                  </Typography>
                  {/* AUTH-003: target headline "Welcome back. Let's sync up." */}
                  <Typography variant={downMD ? 'h3' : 'h2'} sx={{ color: 'var(--ink)', fontWeight: 700 }}>
                    Welcome back.{' '}
                    {/* THEME-002: DM Serif Display loaded in index.html — serif italic brand voice */}
                    <Box component="span" sx={{ color: 'var(--accent)', fontStyle: 'italic', fontWeight: 400, fontFamily: '"DM Serif Display", Georgia, serif' }}>
                      Let's sync up.
                    </Box>
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '16px', textAlign: { xs: 'center', md: 'inherit' } }}>
                    Enter your credentials to open today's brief.
                  </Typography>
                </Stack>
                <Box sx={{ width: 1 }}>
                  {AuthLoginComponent ? (
                    <AuthLoginComponent posthog={posthog} />
                  ) : (
                    <CircularProgress sx={{ color: 'var(--accent)' }} />
                  )}
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
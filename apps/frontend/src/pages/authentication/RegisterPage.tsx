/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/authentication/RegisterPage.tsx
import { Link, useSearchParams } from 'react-router-dom';
import React, { useEffect, useState } from 'react'; // <-- Import React
import { Theme } from '@mui/material/styles';

import useMediaQuery from '@mui/material/useMediaQuery';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

//Analytics
import { usePostHog } from 'posthog-js/react';
import posthog, { PostHog } from 'posthog-js';

// project imports
import AuthWrapper1 from './AuthWrapper1'; 
import AuthCardWrapper from './AuthCardWrapper'; 

import { useAuth } from 'contexts/AuthContext';
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';

// import { 'jwt' } from 'config'; // <-- COMMENT OUT

// A mapping of auth types to dynamic imports
const authRegisterImports = {
//  firebase: () => import('./firebase/AuthRegister'),
  jwt: () => import('./jwt/AuthRegister'),
//  aws: () => import('./aws/AuthRegister'),
//  auth0: () => import('./auth0/AuthRegister'),
//  supabase: () => import('./supabase/AuthRegister')
};

interface AuthRegisterProps {
  posthog: PostHog;
}

export default function Register() {
  const downMD = useMediaQuery((theme: Theme) => theme.breakpoints.down('md')); // <-- Add Theme type
  // AUTH-017: wire real auth state — redirects already-logged-in users away from /register
  const { isLoggedIn } = useAuth();
  const [AuthRegisterComponent, setAuthRegisterComponent] = useState<React.ComponentType<AuthRegisterProps> | null>(null);
  
  const [searchParams] = useSearchParams();
  const authParam = searchParams.get('auth') || '';

  useEffect(() => {
    const selectedAuth = authParam || 'jwt';

    const authRegisterImportsTyped: Record<string, () => Promise<any>> = authRegisterImports as any;
    const importAuthRegisterComponent = authRegisterImportsTyped[selectedAuth];
    importAuthRegisterComponent()
      .then((module: any) => setAuthRegisterComponent(() => module.default))
      .catch((error: any) => {
        console.error(error);
      });
  }, [authParam]);

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'flex-end', minHeight: '100vh' }}>
        <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 68px)' }}>
          {/* AUTH-012: top-left logo nav bar — matches target A2 */}
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

                {/* AUTH-005: step 1 of 2 stepper — matches target A2 */}
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <Box sx={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography sx={{ color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 700 }}>1</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'var(--ink)', fontWeight: 600 }}>Account</Typography>
                  </Stack>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--rule-2)' }} />
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <Box sx={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--rule-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography sx={{ color: 'var(--ink-4)', fontSize: '0.7rem', fontWeight: 500 }}>2</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'var(--ink-3)', fontWeight: 500 }}>Connect store</Typography>
                  </Stack>
                </Stack>

                <Stack sx={{ alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  {/* AUTH-004: target headline */}
                  <Typography variant={downMD ? 'h3' : 'h2'} sx={{ color: 'var(--ink)', fontWeight: 700, mb: 0 }}>
                    Create your account.{' '}
                    {/* THEME-002: DM Serif Display loaded in index.html — serif italic brand voice */}
                    <Box component="span" sx={{ color: 'var(--accent)', fontStyle: 'italic', fontWeight: 400, fontFamily: '"DM Serif Display", Georgia, serif' }}>
                      60 seconds.
                    </Box>
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '16px', textAlign: { xs: 'center', md: 'inherit' }, color: 'var(--ink-3)' }}>
                    You'll connect Shopify in the next step. We never store your password.
                  </Typography>
                </Stack>
                <Box>{AuthRegisterComponent && <AuthRegisterComponent posthog={posthog}/>}</Box>
                <Divider sx={{ width: 1 }} />
                <Stack sx={{ alignItems: 'center' }}>
                  <Typography
                    component={Link}
                    to={authParam ? `/login?auth=${authParam}` : '/login'}
                    variant="subtitle1"
                    sx={{ textDecoration: 'none' }}
                  >
                    Already have an account?
                  </Typography>
                </Stack>
              </Stack>
            </AuthCardWrapper>
          </Box>
        </Stack>
      </Stack>
      {/* AUTH-014: system status pill — top-right */}
      <SocialProofTicker />
    </AuthWrapper1>
  );
}

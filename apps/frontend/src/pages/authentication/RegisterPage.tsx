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
import AuthWrapper1 from './AuthWrapper1'; // <-- USE ALIAS
import AuthCardWrapper from './AuthCardWrapper'; // <-- USE ALIAS
import LoginProvider from './LoginProvider'; // <-- USE ALIAS
// import ViewOnlyAlert from 'pages/authentication/ViewOnlyAlert';

import Logo from 'ui-component/Logo'; // <-- USE ALIAS
import AuthFooter from 'ui-component/cards/AuthFooter';

// import useAuth from 'hooks/useAuth'; // <-- COMMENT OUT
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
  // const { isLoggedIn } = useAuth(); // <-- COMMENT OUT
  const isLoggedIn = false; // <-- Placeholder
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
          <Box sx={{ m: { xs: 1, sm: 3 }, mb: 0 }}>
            {/* {!isLoggedIn && <ViewOnlyAlert />} */}
            <AuthCardWrapper>
              <Stack sx={{ alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <Box sx={{ mb: 3 }}>
                  <Link to="#" aria-label="theme logo">
                    <Logo />
                  </Link>
                </Box>
                <Stack sx={{ alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  {/* AUTH-004: target headline "Create your account. 60 seconds." */}
                  <Typography variant={downMD ? 'h3' : 'h2'} sx={{ color: 'var(--ink)', fontWeight: 700, mb: 0 }}>
                    Create your account.{' '}
                    <Box component="span" sx={{ color: 'var(--accent)', fontStyle: 'italic', fontWeight: 400 }}>
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
                    to={isLoggedIn ? '/pages/login/login3' : authParam ? `/login?auth=${authParam}` : '/login'}
                    variant="subtitle1"
                    sx={{ textDecoration: 'none' }}
                  >
                    Already have an account?
                  </Typography>
                </Stack>
              </Stack>
            </AuthCardWrapper>
            {!isLoggedIn && (
              <Box
                sx={{
                  maxWidth: { xs: 400, lg: 475 },
                  margin: { xs: 2.5, md: 3 },
                  '& > *': {
                    flexGrow: 1,
                    flexBasis: '50%'
                  }
                }}
              >
                <LoginProvider currentLoginWith={'jwt'} />
              </Box>
            )}
          </Box>
        </Stack>
        <Stack sx={{ px: 3, mb: 3, mt: 1 }}>
          <AuthFooter />
        </Stack>
      </Stack>
    </AuthWrapper1>
  );
}

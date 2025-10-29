// berry-material-react-full/src/views/pages/authentication/Login.jsx
import { Link, useSearchParams } from 'react-router-dom';
import React, { useEffect, useState } from 'react'; // <-- Import React
import { Theme } from '@mui/material/styles';

import useMediaQuery from '@mui/material/useMediaQuery';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

// project imports
import AuthWrapper1 from 'pages/authentication/AuthWrapper1'; // <-- USE ALIAS
import AuthCardWrapper from 'pages/authentication/AuthCardWrapper'; // <-- USE ALIAS
import LoginProvider from 'pages/authentication/LoginProvider'; // <-- USE ALIAS
// import ViewOnlyAlert from 'pages/authentication/ViewOnlyAlert';

import Logo from 'ui-component/Logo'; // <-- USE ALIAS (Assuming correct)
import AuthFooter from 'ui-component/cards/AuthFooter';

// import useAuth from 'hooks/useAuth'; // <-- COMMENT OUT for now
// import { APP_AUTH } from 'config';

// A mapping of auth types to dynamic imports
const authLoginImports = {
  // firebase: () => import('./firebase/AuthLogin'), // Keep commented if not used
  jwt: () => import('./jwt/AuthLogin'), // <-- FIX PATH if needed (should be correct now)
  // aws: () => import('./aws/AuthLogin'),       // Keep commented if not used
  // auth0: () => import('./auth0/AuthLogin'),     // Keep commented if not used
  // supabase: () => import('./supabase/AuthLogin') // Keep commented if not used
};

// ================================|| AUTH3 - LOGIN ||================================ //

export default function Login() {
  // const { isLoggedIn } = useAuth(); // <-- COMMENT OUT for now
  const isLoggedIn = false; // <-- Placeholder
  const downMD = useMediaQuery((theme: Theme) => theme.breakpoints.down('md')); // <-- Add Theme type
  const [AuthLoginComponent, setAuthLoginComponent] = useState<React.ComponentType | null>(null); // <-- Add Type

  const [searchParams] = useSearchParams();
  const authParam = searchParams.get('auth') || '';

  useEffect(() => {
    const selectedAuth = authParam || 'jwt'

    const importAuthLoginComponent = authLoginImports[selectedAuth];

    importAuthLoginComponent()
      .then((module) => setAuthLoginComponent(() => module.default))
      .catch((error) => {
        console.error(`Error loading ${selectedAuth} AuthLogin:`, error);
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
                  <Link to="#" aria-label="logo">
                    <Logo />
                  </Link>
                </Box>
                <Stack sx={{ alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <Typography variant={downMD ? 'h3' : 'h2'} sx={{ color: 'secondary.main' }}>
                    Hi, Welcome Back
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '16px', textAlign: { xs: 'center', md: 'inherit' } }}>
                    Enter your credentials to continue
                  </Typography>
                </Stack>
                <Box sx={{ width: 1 }}>{AuthLoginComponent && <AuthLoginComponent />}</Box>
                <Divider sx={{ width: 1 }} />
                <Stack sx={{ alignItems: 'center' }}>
                  <Typography
                    component={Link}
                    to={isLoggedIn ? '/pages/register/register3' : authParam ? `/register?auth=${authParam}` : '/register'}
                    variant="subtitle1"
                    sx={{ textDecoration: 'none' }}
                  >
                    Don&apos;t have an account?
                  </Typography>
                </Stack>
              </Stack>
            </AuthCardWrapper>
            {!isLoggedIn && (
              <Box
                sx={{
                  maxWidth: { xs: 400, lg: 475 },
                  margin: { xs: 2.5, md: 3 },
                  '& > *': { flexGrow: 1, flexBasis: '50%' }
                }}
              >
                <LoginProvider currentLoginWith={'jwt'} />
              </Box>
            )}
          </Box>
        </Stack>
        <Box sx={{ px: 3, my: 3 }}>
          <AuthFooter />
        </Box>
      </Stack>
    </AuthWrapper1>
  );
}

/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/authentication/OAuthButtons.tsx
//
// AUTH-001/002: email/password entry divider.
//
// COMPLIANCE NOTE (Shopify 2.3.1):
// Shopify CTA removed — App Store install is the only path that connects
// a store while the listing is unpublished. See ConnectStorePage.tsx and
// WelcomePage.tsx for the interim "install from App Store" messaging.
// Restore once VITE_SHOPIFY_APP_STORE_URL points at the approved listing.
//
import React from 'react';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';

interface OAuthButtonsProps {
  mode: 'login' | 'register';
}

// Shopify bag icon (inline SVG — no external dep)
function ShopifyIcon() {
  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: 18, height: 18, flexShrink: 0 }} fill="none">
      <path d="M15.337 21.737l4.426-1.053s-1.574-10.94-1.586-11.022c-.012-.082-.087-.136-.16-.136-.074 0-1.378-.099-1.378-.099s-.918-.912-.918-.912v13.222z" fill="#95BF47"/>
      <path d="M12.927 5.004s-.2.058-.53.16c-.316-.91-.874-1.746-1.855-1.746-.027 0-.055.001-.083.003C10.18 3.1 9.863 2.9 9.5 2.9c-2.892 0-4.277 3.618-4.71 5.46l-2.026.628c-.628.197-.648.217-.73.81L.5 20.2l11.91 2.235 6.43-1.531L15.337 5.004h-2.41zm-3.204.98c-.71.218-1.489.46-2.274.704.437-1.686 1.266-2.5 1.99-2.808.178.528.284 1.252.284 2.104zm-1.054-3.127c.13 0 .24.03.333.083-.953.448-1.974 1.578-2.406 3.834l-1.816.562C4.347 5.284 5.537 2.857 8.669 2.857zm1.364 12.58l-.757-4.045s-.665-.403-1.387-.403c-1.118 0-1.174.701-1.174.878 0 .965 2.516 1.333 2.516 3.597 0 1.779-1.128 2.927-2.652 2.927-1.826 0-2.76-1.137-2.76-1.137l.488-1.614s.962.825 1.775.825c.53 0 .748-.418.748-.723 0-1.261-2.064-1.317-2.064-3.387 0-1.741 1.25-3.428 3.766-3.428.97 0 1.452.277 1.452.277l-.951 6.233z" fill="#5E8E3E"/>
      <path d="M12.397 5.164l-.53.16c-.316-.91-.874-1.746-1.855-1.746l-.083.003C10.18 3.1 9.863 2.9 9.5 2.9c-2.892 0-4.277 3.618-4.71 5.46l-2.026.628c-.628.197-.648.217-.73.81L.5 20.2l11.91 2.235-.013-17.271z" fill="#95BF47"/>
    </Box>
  );
}

// Google G icon
function GoogleIcon() {
  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: 18, height: 18, flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </Box>
  );
}

export default function OAuthButtons({ mode }: OAuthButtonsProps) {
  return (
    <Stack spacing={1.5} width="100%">
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.5 }}>
        <Divider sx={{ flex: 1, borderColor: 'var(--rule)' }} />
        <Typography variant="caption" sx={{ color: 'var(--ink-4)', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
          {mode === 'login' ? 'EMAIL' : 'SIGN UP WITH EMAIL'}
        </Typography>
        <Divider sx={{ flex: 1, borderColor: 'var(--rule)' }} />
      </Stack>
    </Stack>
  );
}
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/authentication/ConnectStorePage.tsx
//
// AUTH-005/006: Step 2 of registration — connect Shopify store (target design A3)
//
// Flow: /register → /connect-store → OAuth → dashboard
// This page is auth-protected (user has token from registration).
// Skip option lands on dashboard (WelcomePage handles no-integration state).
//
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from 'contexts/AuthContext';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import FormHelperText from '@mui/material/FormHelperText';
import AuthWrapper1 from './AuthWrapper1';
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';
import { AuthLogo } from './AuthLogo';

// Data access scopes shown to user — matches target A3 "What we'll read"
const SCOPES = [
  'Products & variants',
  'Inventory levels',
  'Orders & fulfillments',
  'Customers',
];

type Step = 1 | 2;

export default function ConnectStorePage() {
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [shopName, setShopName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // handle the verified=true redirect from verifyEmail controller
  const searchParams = new URLSearchParams(window.location.search);
  const justVerified = searchParams.get('verified') === 'true';

  const handleConnect = async () => {
    if (!shopName.trim()) {
      setError('Please enter your Shopify store name.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const { data } = await axiosInstance.get('/api/v1/integrations/oauth/initiate', {
        params: { platform: 'shopify', shop: shopName.trim() },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (data.authorizationUrl) {
        // Small delay to let PostHog flush before navigation
        setTimeout(() => { window.location.href = data.authorizationUrl; }, 150);
      }
    } catch {
      setError('Failed to initiate connection. Please check your store name and try again.');
      setIsLoading(false);
    }
  };

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>

        {/* Nav bar — logo + status pill */}
        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <Link to="/" aria-label="LaSyncro home">
            <AuthLogo />
          </Link>
          <SystemStatusPill />
        </Box>

        {/* Card */}
        <Box sx={{ width: '100%', maxWidth: 520, mx: 'auto', px: { xs: 2, sm: 3 } }}>
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 3, p: { xs: 3, sm: 4 } }}>

            {/* AUTH-005: 2-step stepper */}
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
              {/* Step 1 — complete */}
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: '#fff', fontSize: '0.7rem', fontWeight: 700 }}>✓</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'var(--ink-3)', fontWeight: 500 }}>Account</Typography>
              </Stack>

              {/* Connector — splits around verified badge when present */}
              {justVerified ? (
                <>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--accent)' }} />
                  <Box sx={{ bgcolor: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 99, px: 1, py: 0.25, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <Typography sx={{ color: '#4ADE80', fontSize: '0.65rem', fontWeight: 600 }}>✓ Email verified</Typography>
                  </Box>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--accent)' }} />
                </>
              ) : (
                <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--accent)' }} />
              )}

              {/* Step 2 — active */}
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Box sx={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 700 }}>2</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'var(--ink)', fontWeight: 600 }}>Connect store</Typography>
              </Stack>
            </Stack>

            {/* Headline */}
            <Typography variant="h2" sx={{ color: 'var(--ink)', fontWeight: 700, mb: 0.5 }}>
              Now connect{' '}
              <Box component="span" sx={{ color: 'var(--accent)', fontStyle: 'italic', fontWeight: 400 }}>
                your Shopify store.
              </Box>
            </Typography>
            <Typography variant="body2" sx={{ color: 'var(--ink-3)', mb: 3 }}>
              We read orders, inventory, and product data. Read-only by default — you control writes.
            </Typography>

            {/* Scopes list */}
            <Box sx={{ bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', borderRadius: 2, p: 2, mb: 3 }}>
              <Typography variant="caption" sx={{ color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', mb: 1 }}>
                What we'll read
              </Typography>
              <Stack spacing={0.75}>
                {SCOPES.map((scope) => (
                  <Stack key={scope} direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Typography sx={{ color: '#fff', fontSize: '0.6rem', fontWeight: 700 }}>✓</Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: 'var(--ink-2)' }}>{scope}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>

            {/* Store input */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" sx={{ color: 'var(--ink-3)', fontWeight: 500, display: 'block', mb: 0.75 }}>
                Your Shopify store
              </Typography>
              <OutlinedInput
                fullWidth
                placeholder="your-store"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                endAdornment={
                  <InputAdornment position="end">
                    <Typography variant="caption" sx={{ color: 'var(--ink-3)' }}>.myshopify.com</Typography>
                  </InputAdornment>
                }
                sx={{ bgcolor: 'var(--bg)', '& fieldset': { borderColor: 'var(--rule)' } }}
              />
              {error && <FormHelperText error sx={{ mt: 0.5 }}>{error}</FormHelperText>}
            </Box>

            {/* CTAs */}
            <Stack direction="row" spacing={1.5}>
              <Button
                variant="outlined"
                onClick={() => navigate(-1)}
                sx={{ border: '1px solid var(--rule-2)', color: 'var(--ink-2)', '&:hover': { bgcolor: 'var(--bg-2)' }, flexShrink: 0 }}
              >
                ← Back
              </Button>
              <Button
                fullWidth
                variant="contained"
                onClick={handleConnect}
                disabled={isLoading}
                sx={{ bgcolor: 'var(--accent)', color: '#fff', fontWeight: 700, '&:hover': { bgcolor: 'var(--accent-hover)' }, '&:disabled': { opacity: 0.6 } }}
              >
                {isLoading ? 'Connecting...' : 'Connect Shopify →'}
              </Button>
            </Stack>

            {/* Skip */}
            <Box sx={{ textAlign: 'center', mt: 2 }}>
              <Typography
                component={Link}
                to="/"
                variant="caption"
                sx={{ color: 'var(--ink-4)', textDecoration: 'underline', '&:hover': { color: 'var(--ink-3)' } }}
              >
                Prefer to do this later? Skip — connect after first login
              </Typography>
            </Box>

          </Box>
        </Box>

        <SocialProofTicker />
      </Stack>
    </AuthWrapper1>
  );
}
// apps/frontend/src/pages/authentication/ConnectStorePage.tsx
//
// AUTH-005/006: Step 2 of registration — connect Shopify store
//
// COMPLIANCE NOTE (Shopify 2.3.1):
// No manual .myshopify.com entry permitted while the App Store listing is
// unpublished. Shows an interim notice instead of a form. Once
// SHOPIFY_APP_STORE_URL is set (post-approval), restore the real
// "Connect with Shopify" redirect flow here.
//
import React from 'react';
import { Link } from 'react-router-dom';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AuthWrapper1 from './AuthWrapper1';
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';
import { SHOPIFY_APP_STORE_URL } from 'lib/appStoreUrl';

const SCOPES = [
  'Products & variants',
  'Inventory levels',
  'Orders & fulfillments',
  'Customers',
];

export default function ConnectStorePage() {
  const searchParams = new URLSearchParams(window.location.search);
  const justVerified = searchParams.get('verified') === 'true';

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>

        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <Link to="/" aria-label="LaSyncro home"></Link>
          <SystemStatusPill />
        </Box>

        <Box sx={{ width: '100%', maxWidth: 520, mx: 'auto', px: { xs:2, sm: 3 } }}>
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 3, p: { xs: 3, sm: 4 } }}>

            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: '#fff', fontSize: '0.7rem', fontWeight: 700 }}>✓</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'var(--ink-3)', fontWeight: 500 }}>Account</Typography>
              </Stack>

              {justVerified ? (
                <>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--accent)' }} />
                  <Box sx={{ bgcolor: 'rgba(74,222,128,0.10)', border:'1px solid rgba(74,222,128,0.3)', borderRadius: 99, px: 1, py: 0.25, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <Typography sx={{ color: '#4ADE80', fontSize: '0.65rem', fontWeight: 600 }}>✓ Email verified</Typography>
                  </Box>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--accent)' }} />
                </>
              ) : (
                <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--accent)' }} />
              )}

              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Box sx={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 700 }}>2</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'var(--ink)', fontWeight: 600 }}>Connect store</Typography>
              </Stack>
            </Stack>

            <Typography variant="h2" sx={{ color: 'var(--ink)', fontWeight: 700, mb: 0.5 }}>
              Almost there.
            </Typography>
            <Typography variant="body2" sx={{ color: 'var(--ink-3)', mb: 3 }}>
              We read your orders, inventory, and product data, and write inventory and fulfillment updates back to Shopify as you receive, pick, pack, and ship.            </Typography>

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

            {/* Interim notice — replaces manual store-domain entry (Shopify 2.3.1) */}
            <Box sx={{ bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', borderRadius: 2, p: 2.5, mb: 2 }}>
              <Typography variant="body2" sx={{ color: 'var(--ink-2)', mb: 1.5 }}>
                LaSyncro is being reviewed for the Shopify App Store. Once approved, you'll be able to install it directly from there.
              </Typography>
              {SHOPIFY_APP_STORE_URL ? (
                <Button
                  component="a"
                  href={SHOPIFY_APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  fullWidth
                  variant="contained"
                  sx={{ bgcolor: 'var(--accent)', color: '#fff', fontWeight: 700, '&:hover': { bgcolor: 'var(--accent-hover)' } }}
                >
                  Install LaSyncro from the Shopify App Store →
                </Button>
              ) : (
                <Typography variant="body2" sx={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>
                  Install LaSyncro from the Shopify App Store (link goes live on approval)
                </Typography>
              )}
            </Box>

          </Box>
        </Box>

        <SocialProofTicker />
      </Stack>
    </AuthWrapper1>
  );
}
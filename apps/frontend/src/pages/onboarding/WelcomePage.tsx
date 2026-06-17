// apps/frontend/src/pages/onboarding/WelcomePage.tsx
import {
  Box,
  Container,
  Typography,
  Button,
  Stack,
  useTheme,
} from '@mui/material';
import { BarChart3, PackageCheck, DollarSign } from 'lucide-react';
import { SHOPIFY_APP_STORE_URL } from 'lib/appStoreUrl';

/**
 * WELCOME PAGE — FT_MINUS_ONE
 * ----------------------------
 * Single onboarding surface shown before any store integration.
 *
 * Design contracts (consortium):
 * - One page. One CTA. No module language.
 * - User vocabulary only — no system/technical terms.
 * - Trust signals below the fold — anxiety reduction.
 * - COMPLIANCE (Shopify 2.3.1): CTA points to the App Store listing once
 *   approved; no manual store-domain entry. See lib/appStoreUrl.ts.
 *
 * Replaces per-module activation configs for FT_MINUS_ONE phase.
 * Per-module activation surfaces are preserved for FT1 (locked modules).
 */

const VALUE_PROPS = [
  {
    icon: BarChart3,
    title: 'Operational Clarity',
    body: 'See every order, fulfillment, and return in one place — no spreadsheets.',
  },
  {
    icon: DollarSign,
    title: 'Financial Visibility',
    body: 'Know which orders are actually profitable before they ship.',
  },
  {
    icon: PackageCheck,
    title: 'Warehouse Control',
    body: 'Pick, pack, and ship faster with a warehouse system built for your team.',
  },
];

const TRUST_SIGNALS = [
  'You control every write',
  'Full audit trail',
  'No customer data stored',
  'Encrypted end-to-end',
  'Disconnect anytime',
];

export default function WelcomePage() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background.default',
        py: 6,
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={6} alignItems="center">

          {/* ── HERO ─────────────────────────────────────────── */}
          <Stack spacing={1.5} alignItems="center" textAlign="center">
            <Typography
              variant="h3"
              fontWeight={800}
              letterSpacing={-1}
              sx={{ lineHeight: 1.1 }}
            >
              The operating system
              <br />
              for your commerce business.
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ maxWidth: 400 }}
            >
              LaSyncro connects your store, warehouse, and finances into a
              single source of truth — so you can operate with confidence.
            </Typography>
          </Stack>

          {/* ── VALUE PROPS ──────────────────────────────────── */}
          <Stack spacing={2} width="100%">
            {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
              <Box
                key={title}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 2,
                  p: 2.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  backgroundColor: 'background.paper',
                }}
              >
                <Box
                  sx={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: 1.5,
                    backgroundColor: theme.palette.primary.main,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size={20} color={theme.palette.primary.contrastText} />
                </Box>
                <Box>
                  <Typography variant="body1" fontWeight={700}>
                    {title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    {body}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>

          {/* ── CTA ──────────────────────────────────────────── */}
          <Stack spacing={1.5} alignItems="center" width="100%">
            <Typography variant="body2" color="text.secondary" textAlign="center">
              LaSyncro is being reviewed for the Shopify App Store. Once approved, you'll be able to install it directly from there.
            </Typography>

            {SHOPIFY_APP_STORE_URL ? (
              <Button
                component="a"
                href={SHOPIFY_APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                variant="contained"
                size="large"
                fullWidth
                sx={{
                  fontWeight: 800,
                  fontSize: '1rem',
                  py: 1.5,
                  borderRadius: 2,
                }}
              >
                Install LaSyncro from the Shopify App Store →
              </Button>
            ) : (
              <Typography variant="body2" color="text.disabled" fontStyle="italic">
                Install LaSyncro from the Shopify App Store (link goes live on approval)
              </Typography>
            )}

            {/* TRUST SIGNALS */}
            <Stack
              direction="row"
              flexWrap="wrap"
              justifyContent="center"
              gap={1.5}
            >
              {TRUST_SIGNALS.map((signal) => (
                <Typography
                  key={signal}
                  variant="caption"
                  color="text.disabled"
                >
                  {signal}
                </Typography>
              ))}
            </Stack>
          </Stack>

        </Stack>
      </Container>
    </Box>
  );
}
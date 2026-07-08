// apps/frontend/src/pages/ft2-pages/SettingsShellHeader.tsx
//
// Shared shell header for all /settings/* tabs, including /team which
// lives outside ShopSettingsPage's own <Routes> subtree (ISS-048/ISS-051,
// product-structure.md §4/§5). Extracted here — not duplicated inline —
// so the two render sites (ShopSettingsPage.tsx, MembersPage.tsx) can
// never drift (ISS-053).
//
// This is the OUTER "Shop Settings" shell title, distinct from each tab's
// own page-specific heading (e.g. MembersPage still renders its own
// "Team" / "Manage shop members and their roles." below this).
import { Box, Typography } from '@mui/material';

export function SettingsShellHeader() {
  return (
    <Box sx={{ px: 2.5, pt: 2.5, pb: 0 }}>
      <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
        Shop Settings
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: '2px', mb: 1.5 }}>
        Operational configuration for your shop.
      </Typography>
    </Box>
  );
}
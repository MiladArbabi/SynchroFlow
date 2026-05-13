// apps/frontend/src/pages/ft2-pages/ProductsCostsPage.tsx
//
// ProductsCostsPage
// -----------------
// Cost entry and bulk CSV upload surface.
// Moved from the main Intelligence tab — cost entry is a setup task,
// not a daily signal. Keeping it separate reduces noise on the
// Intelligence tab for operators who have already entered costs.
//
// HARD CONTRACT:
// - Authenticated + shop-scoped (via CostEntryPanel internals)
// - No intelligence signals here
// - Period-independent — cost data is not time-ranged

import CostEntryPanel from 'components/CostEntryPanel';
import { Box } from '@mui/material';

export default function ProductsCostsPage() {
  return (
    <Box>
      <CostEntryPanel />
    </Box>
  );
}
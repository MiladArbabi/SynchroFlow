// RECOUNT-FRESH-NOBINS-40
//
// Distinguishes "nothing configured yet" from "nothing currently needs
// reconciliation" in the Reconcile Inventory dialog. Both states used to
// render the identical "No suggested bins right now." copy, leaving a
// merchant with zero bins no path forward and a fully-configured merchant
// no reassurance that the empty result was expected.
//
// Extracted as its own component (rather than inlined in WmsModuleFT2) so
// its DOM contract can be proven with a direct render — WmsModuleFT2's
// 30+ prop surface is unrelated to this issue.
import { Alert, Box, Button, Typography } from '@mui/material';
import { WMS_TIER1_ACTION_SX } from '../pages/CountingSessionPage';
import type { RecountBinAvailability } from '../pages/recountSelection';

export interface RecountEmptyStateProps {
  availability: RecountBinAvailability;
  onSetupBinsClick: () => void;
}

export function RecountEmptyState({
  availability,
  onSetupBinsClick,
}: RecountEmptyStateProps) {
  // 'suggestions_available': the canvas/fallback suggestion UI owns this
  // state. 'unknown': the warehouse-grid query has not resolved yet — do
  // not guess at bin configuration before it does.
  if (availability === 'suggestions_available' || availability === 'unknown') {
    return null;
  }

  if (availability === 'no_bins_configured') {
    return (
      <Box sx={{ mb: 2 }}>
        <Alert severity="info" sx={{ mb: 1 }}>
          Set up your warehouse bins before creating an inventory count.
        </Alert>
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mb: 1.5 }}>
          Recounts check quantities at physical storage locations — bins,
          shelves, and lanes — not products in the abstract.
        </Typography>
        <Button
          variant="contained"
          onClick={onSetupBinsClick}
          sx={{ ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600 }}
        >
          Set up bins
        </Button>
      </Box>
    );
  }

  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      No bins currently need reconciliation.
    </Alert>
  );
}

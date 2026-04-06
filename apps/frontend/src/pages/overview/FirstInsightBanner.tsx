// apps/frontend/src/pages/overview/FirstInsightBanner.tsx

import { useState, useEffect } from 'react';
import { Box, Typography, Button, IconButton } from '@mui/material';
import { X } from 'lucide-react';

/**
 * FIRST INSIGHT BANNER (B-06)
 * ---------------------------
 * Surfaces the operator's first meaningful insight on arrival.
 *
 * Design rules (UX Consortium §VIII):
 * - Appears automatically when constrained orders exist
 * - No setup required — uses live data
 * - Dismissible — stored in sessionStorage (reappears next session)
 * - Never shows if no constrained orders exist (nothing to say)
 * - Named from operator vocabulary — never system language
 *
 * Bernays moment: operator feels the platform already knows their business.
 */

const DISMISSED_KEY = 'lasyncro_first_insight_dismissed';

type FirstInsightBannerProps = {
  constrainedCount: number | null;
  atRiskRevenue: number | null;
  onNavigateToQueue: () => void;
};

export function FirstInsightBanner({
  constrainedCount,
  atRiskRevenue,
  onNavigateToQueue,
}: FirstInsightBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    /**
     * Check session dismissal on mount.
     * sessionStorage clears on tab close — reappears next session.
     */
    const wasDismissed = sessionStorage.getItem(DISMISSED_KEY) === 'true';
    setDismissed(wasDismissed);
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  };

  /**
   * Only show when:
   * - Not dismissed this session
   * - There are actually constrained orders to act on
   */
  if (dismissed || !constrainedCount || constrainedCount === 0) {
    return null;
  }

  const revenueText =
    atRiskRevenue != null && atRiskRevenue > 0
      ? ` with $${Math.round(Number(atRiskRevenue)).toLocaleString()} at risk`
      : '';

  return (
    <Box
      sx={{
        mx: 3,
        mt: 2,
        p: 2.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'warning.light',
        borderLeft: '4px solid',
        borderLeftColor: 'warning.main',
        bgcolor: 'warning.50',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Box>
        <Typography variant="body1" fontWeight={600}>
          You have {constrainedCount} orders that need attention{revenueText}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          LaSyncro has identified orders blocked from shipping. Review them now to keep your operations moving.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <Button
          variant="contained"
          size="small"
          onClick={() => {
            handleDismiss();
            onNavigateToQueue();
          }}
        >
          Review Queue
        </Button>
        <IconButton size="small" onClick={handleDismiss}>
          <X size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}
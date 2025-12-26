// apps/frontend/src/components/EmptyStates/EmptyDashboardState.tsx

import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, LinearProgress, Fade, Paper } from '@mui/material';

const MIN_VISIBLE_MS = 5000; // perceptual minimum — GUARANTEED

export const EmptyDashboardState: React.FC = () => {
  const mountTs = useRef<number>(performance.now());

  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);

  /* ------------------------------------------------------------------ */
  /* Progress animation                                                  */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const start = performance.now();
    const duration = 5000;

    let rafId: number;

    const tick = () => {
      const elapsed = performance.now() - start;
      const t = Math.min(elapsed / duration, 1);

      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased * 100);

      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Minimum visibility enforcement                                      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    return () => {
      const elapsed = performance.now() - mountTs.current;

      if (elapsed < MIN_VISIBLE_MS) {
        const remaining = MIN_VISIBLE_MS - elapsed;

        // Prevent immediate disappearance
        setTimeout(() => {
          setVisible(false);
        }, remaining);
      } else {
        setVisible(false);
      }
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <Fade in={visible} timeout={300}>
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            maxWidth: 520,
            width: '100%',
            p: 4,
            textAlign: 'center',
            backgroundColor: 'background.paper',
          }}
        >
          <Typography variant="h5" fontWeight={600} gutterBottom>
            Preparing your dashboard
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 4 }}
          >
            We’re syncing and analyzing your data.
            <br />
            This will only take a moment.
          </Typography>

          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: (theme) =>
                theme.palette.action.hover,
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
              },
            }}
          />
        </Paper>
      </Box>
    </Fade>
  );
};

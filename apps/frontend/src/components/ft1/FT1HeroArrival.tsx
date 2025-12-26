//apps/frontend/src/components/ft1/FT1HeroArrival.tsx
import { useEffect, useState } from 'react';
import { Box, Paper, Typography, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

interface FT1HeroArrivalProps {
  shopId: number;
}

const STORAGE_KEY_PREFIX = 'ft1-hero-seen';

export function FT1HeroArrival({ shopId }: FT1HeroArrivalProps) {
  const storageKey = `${STORAGE_KEY_PREFIX}:${shopId}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const alreadySeen = localStorage.getItem(storageKey) === 'true';

    if (alreadySeen) return;

    setVisible(true);

    if (import.meta.env.DEV) {
      console.info('[FT1][Hero] Shown', { shopId });
    }

    const AUTO_DISMISS_MS = 7000;

    const timer = setTimeout(() => {
      dismiss('auto');
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  const dismiss = (reason: 'auto' | 'manual') => {
    localStorage.setItem(storageKey, 'true');
    setVisible(false);

    if (import.meta.env.DEV) {
      console.info('[FT1][Hero] Dismissed', { shopId, reason });
    }
  };

  if (!visible) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 2,
          backgroundColor: 'background.default',
          border: '1px solid',
          borderColor: 'divider',
          position: 'relative',
        }}
      >
        <IconButton
          size="small"
          onClick={() => dismiss('manual')}
          sx={{ position: 'absolute', top: 8, right: 8 }}
          aria-label="Dismiss"
        >
          <CloseIcon fontSize="small" />
        </IconButton>

        <Typography variant="h6" sx={{ mb: 1 }}>
          You’re live 🎉
        </Typography>

        <Typography variant="body2" color="text.secondary">
          Your data is flowing and insights are starting to form.
          <br />
          Here’s what we’ve found so far.
        </Typography>
      </Paper>
    </Box>
  );
}

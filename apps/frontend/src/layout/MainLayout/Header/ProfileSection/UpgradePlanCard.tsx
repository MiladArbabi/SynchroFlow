// apps/frontend/src/layout/MainLayout/Header/ProfileSection/UpgradePlanCard.tsx
import React from 'react';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { SxProps } from '@mui/system';


// project imports
import AnimateButton from 'ui-component/extended/AnimateButton'; // Use our stub

// ==============================|| PROFILE MENU - UPGRADE PLAN CARD ||============================== //

const UpgradePlanCard: React.FC = () => {
  const theme = useTheme();

  // Define common SX for pseudo-elements, ensure type correctness
  const cardPseudoElementSX: SxProps<Theme> = {
    content: '""',
    position: 'absolute',
    width: 200,
    height: 200,
    borderColor: theme.palette.warning.main // Access color safely
  };

  return (
    <Card
      sx={{
        bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey?.['800'] || '#1a223f' : theme.palette.warning.light, // Conditional background
        my: 2,
        overflow: 'hidden',
        position: 'relative',
        '&:after': {
          border: '19px solid ', // Keep border style
          borderRadius: '50%',
          top: '65px',
          right: '-150px',
          ...cardPseudoElementSX // Spread common styles
        },
        '&:before': {
          border: '3px solid ', // Keep border style
          borderRadius: '50%',
          top: '145px',
          right: '-70px',
          ...cardPseudoElementSX // Spread common styles
        }
      }}
    >
      <CardContent>
        <Stack spacing={2}> {/* Use spacing prop */}
          <Typography variant="h4">Upgrade your plan</Typography>
          <Typography
            variant="subtitle2"
            sx={{
              color: theme.palette.mode === 'dark' ? theme.palette.text.secondary : theme.palette.grey[900], // Conditional color
              opacity: theme.palette.mode === 'dark' ? 1 : 0.6, // Conditional opacity
            }}
          >
            70% discount for 1 year <br /> {/* Corrected typo */}
            subscriptions.
          </Typography>
          <Stack direction="row">
            {/* External Link */}
            <Link sx={{ textDecoration: 'none' }} href="https://links.codedthemes.com/hsqll" target="_blank">
              <AnimateButton>
                <Button
                  variant="contained"
                  color="warning"
                  sx={{
                      boxShadow: 'none',
                      // Conditional text color for dark mode
                      color: theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.warning.dark
                  }}
                >
                  Go Premium
                </Button>
              </AnimateButton>
            </Link>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default UpgradePlanCard;
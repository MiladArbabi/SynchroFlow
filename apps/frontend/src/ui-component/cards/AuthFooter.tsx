// material-ui
import React from 'react'; // <-- Import React
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';

// ==============================|| FOOTER - AUTHENTICATION 2 & 3 ||============================== //

export default function AuthFooter() {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant="subtitle2" component={Link} href="https://www.lasyncro.com" target="_blank" underline="hover"> {/* <-- Update URL */}
        laSyncro.com 
      </Typography>
      <Typography variant="subtitle2" component={Link} href="https://www.lasyncro.com/privacy" target="_blank" underline="hover"> {/* <-- Update URL */}
        Privacy Policy 
      </Typography>
    </Stack>
  );
}

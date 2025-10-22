// packages/ui/src/layout/MainLayout/Header/NotificationSection/NotificationList.tsx
import React from 'react';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { SxProps } from '@mui/system';


// project imports
import { withAlpha } from 'utils/colorUtils'; // Ensure typed later

// assets
import { IconBrandTelegram, IconBuildingStore, IconMailbox, IconPhoto } from '@tabler/icons-react';
import User1 from 'assets/images/users/user-round.svg'; // Use imported asset

// Define Props for ListItemWrapper
interface ListItemWrapperProps {
  children: React.ReactNode;
}

// Internal ListItemWrapper component
const ListItemWrapper: React.FC<ListItemWrapperProps> = ({ children }) => {
  const theme = useTheme();

  const wrapperSx: SxProps<Theme> = {
    p: 2,
    borderBottom: '1px solid',
    borderColor: 'divider',
    cursor: 'pointer',
    '&:hover': {
      bgcolor: theme.palette.mode === 'dark'
        ? theme.palette.dark?.['900'] || '#111936' // Use augmented dark color or fallback
        : withAlpha(theme.palette.grey[200] || '#e3e8ef', 0.3), // Fallback for grey[200]
    }
  };

  return (
    <Box sx={wrapperSx}>
      {children}
    </Box>
  );
};

// ==============================|| NOTIFICATION LIST ITEM ||============================== //

const NotificationList: React.FC = () => {
  const theme = useTheme();
  const containerSX: SxProps<Theme> = { gap: 1, pl: '56px' }; // Adjusted spacing based on Avatar size + padding

  // Helper function to get Avatar background color based on theme mode
  const getAvatarBgColor = (lightColor: string, darkColorKey: keyof typeof theme.palette.dark = 'main') => {
      return theme.palette.mode === 'dark' ? theme.palette.dark?.[darkColorKey] || '#111936' : lightColor;
  };


  return (
    // Adjust maxWidth if needed, remove xs breakpoint if defaulting to one size
    <List sx={{ width: '100%', maxWidth: 330, py: 0 }}>
      <ListItemWrapper>
        <ListItem alignItems="center" disablePadding secondaryAction={
            <Typography variant="caption" color="textSecondary">2 min ago</Typography> // Simplified secondaryAction
        }>
          <ListItemAvatar>
            <Avatar alt="John Doe" src={User1} />
          </ListItemAvatar>
          <ListItemText primary={<Typography variant="subtitle1">John Doe</Typography>} />
        </ListItem>
        <Stack sx={containerSX}>
          <Typography variant="subtitle2">It is a long established fact that a reader will be distracted</Typography>
          <Stack direction="row" spacing={1}> {/* Use spacing */}
            <Chip label="Unread" color="error" size="small" sx={{ width: 'min-content' }} />
            <Chip label="New" color="warning" size="small" sx={{ width: 'min-content' }} />
          </Stack>
        </Stack>
      </ListItemWrapper>
      <ListItemWrapper>
        <ListItem alignItems="center" disablePadding secondaryAction={
             <Typography variant="caption" color="textSecondary">5 min ago</Typography>
        }>
          <ListItemAvatar>
            <Avatar sx={{ color: 'success.dark', bgcolor: getAvatarBgColor(theme.palette.success.light) }}>
              <IconBuildingStore stroke={1.5} size="20px" />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary={<Typography variant="subtitle1">Store Verification Done</Typography>} />
        </ListItem>
        <Stack sx={containerSX}>
          <Typography variant="subtitle2">We have successfully received your request.</Typography>
          <Chip label="Unread" color="error" size="small" sx={{ width: 'min-content' }} />
        </Stack>
      </ListItemWrapper>
      <ListItemWrapper>
        <ListItem alignItems="center" disablePadding secondaryAction={
             <Typography variant="caption" color="textSecondary">10 min ago</Typography>
        }>
          <ListItemAvatar>
            <Avatar sx={{ color: 'primary.dark', bgcolor: getAvatarBgColor(theme.palette.primary.light) }}>
              <IconMailbox stroke={1.5} size="20px" />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary={<Typography variant="subtitle1">Check Your Mail.</Typography>} />
        </ListItem>
        <Stack sx={containerSX}>
          <Typography variant="subtitle2">All done! Now check your inbox as you&apos;re in for a sweet treat!</Typography>
          <Button variant="contained" endIcon={<IconBrandTelegram stroke={1.5} size={20} />} sx={{ width: 'min-content', mt: 1 }}>
            Mail
          </Button>
        </Stack>
      </ListItemWrapper>
       <ListItemWrapper>
           <ListItem alignItems="center" disablePadding secondaryAction={
               <Typography variant="caption" color="textSecondary">1 hour ago</Typography>
           }>
               <ListItemAvatar>
                   <Avatar alt="Jane Smith" src={User1} /> {/* Use different avatar if available */}
               </ListItemAvatar>
               <ListItemText primary={<Typography variant="subtitle1">Jane Smith</Typography>} />
           </ListItem>
           <Stack sx={containerSX}>
               <Typography component="span" variant="subtitle2">
                   Uploaded two file on &nbsp;
                   <Typography component="span" variant="subtitle1" sx={{ fontWeight: 600 }}> {/* Use subtitle1 with bold */}
                       21 Oct 2025
                   </Typography>
               </Typography>
                {/* Inner card for file */}
               <Card sx={{ bgcolor: getAvatarBgColor(theme.palette.secondary.light), mt: 1 }}>
                   <Stack direction="row" sx={{ p: 1.5, gap: 1, alignItems: 'center' }}> {/* Adjust padding/gap */}
                       <IconPhoto stroke={1.5} size="20px" />
                       <Typography variant="subtitle2">demo.jpg</Typography>
                   </Stack>
               </Card>
           </Stack>
       </ListItemWrapper>
        <ListItemWrapper>
            <ListItem alignItems="center" disablePadding secondaryAction={
                 <Typography variant="caption" color="textSecondary">Yesterday</Typography>
            }>
                <ListItemAvatar>
                    <Avatar alt="Admin User" src={User1} /> {/* Use different avatar if available */}
                </ListItemAvatar>
                <ListItemText primary={<Typography variant="subtitle1">System Admin</Typography>} />
            </ListItem>
            <Stack sx={containerSX}>
                <Typography variant="subtitle2">Account confirmation required.</Typography>
                <Chip label="Confirmation" color="success" size="small" sx={{ width: 'min-content' }} />
            </Stack>
        </ListItemWrapper>
    </List>
  );
};

export default NotificationList;
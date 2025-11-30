/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layout/MainLayout/Header/NotificationSection/NotificationList.tsx
import React from 'react';
import { useTheme, Theme } from '@mui/material/styles';
import {
  Avatar,
  Button,
  Card,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
  Box
} from '@mui/material';
import { SxProps } from '@mui/system';
import { withAlpha } from 'utils/colorUtils';
import { IconBrandTelegram, IconBuildingStore, IconMailbox, IconPhoto } from '@tabler/icons-react';
import User1 from 'assets/images/users/user-round.svg';

// --- 1. DEFINE A REUSABLE NOTIFICATION TYPE ---
export interface INotification {
  id: string;
  avatar: string | React.ReactElement;
  title: string;
  message: string | React.ReactElement;
  timestamp: string;
  tags?: { label: string; color: 'error' | 'warning' | 'success' }[];
  actions?: React.ReactElement;
}

// --- 2. DEFINE PROPS FOR THE COMPONENT ---
interface NotificationListProps {
  notifications: INotification[];
}

// Internal ListItemWrapper component
const ListItemWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useTheme();
  const wrapperSx: SxProps<Theme> = {
    p: 2,
    borderBottom: '1px solid',
    borderColor: 'divider',
    cursor: 'pointer',
    '&:hover': {
      bgcolor: theme.palette.mode === 'dark'
        ? theme.palette.dark?.['900'] || '#111936'
        : withAlpha(theme.palette.grey[200] || '#e3e8ef', 0.3),
    }
  };

  return <Box sx={wrapperSx}>{children}</Box>;
};

// ==============================|| NOTIFICATION LIST ||============================== //

const NotificationList: React.FC<NotificationListProps> = ({ notifications }) => {
  const theme = useTheme();
  const containerSX: SxProps<Theme> = { gap: 1, pl: '56px' };

  // Helper to render the avatar
  const renderAvatar = (item: INotification) => {
    if (typeof item.avatar === 'string') {
      return <Avatar alt={item.title} src={item.avatar} />;
    }
    // We assume it's a ReactElement (like an icon)
    return <Avatar sx={{
      color: 'success.dark', // Example, this could be dynamic
      bgcolor: theme.palette.mode === 'dark' ? theme.palette.dark.main : theme.palette.success.light
    }}>
      {item.avatar}
    </Avatar>;
  };

  return (
    // 3. MAP OVER THE NOTIFICATIONS PROP
    <List sx={{ width: '100%', maxWidth: 330, py: 0 }}>
      {notifications.map((item) => (
        <ListItemWrapper key={item.id}>
          <ListItem alignItems="center" disablePadding secondaryAction={
            <Typography variant="caption" color="textSecondary">{item.timestamp}</Typography>
          }>
            <ListItemAvatar>
              {renderAvatar(item)}
            </ListItemAvatar>
            <ListItemText primary={<Typography variant="subtitle1">{item.title}</Typography>} />
          </ListItem>
          <Stack sx={containerSX}>
            <Typography variant="subtitle2" component="span">{item.message}</Typography>
            {item.tags && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {item.tags.map(tag => (
                  <Chip key={tag.label} label={tag.label} color={tag.color} size="small" sx={{ width: 'min-content' }} />
                ))}
              </Stack>
            )}
            {item.actions && <Box sx={{ mt: 1 }}>{item.actions}</Box>}
          </Stack>
        </ListItemWrapper>
      ))}
    </List>
  );
};

export default NotificationList;
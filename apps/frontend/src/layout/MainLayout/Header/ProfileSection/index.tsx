// apps/frontend/src/layout/MainLayout/Header/ProfileSection/index.tsx
import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Popper, Paper, ClickAwayListener,
  List, ListItemButton, ListItemIcon, ListItemText, Divider,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { Settings, LogOut } from 'lucide-react';
import { useAuth } from 'contexts/AuthContext';
import { axiosInstance } from 'api/axiosConfig';
import Transitions from 'ui-component/extended/Transitions';

// ─── PROFILE MENU ─────────────────────────────────────────────────────────────

const ProfileSection: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const prevOpen = useRef(open);

  useEffect(() => {
    if (prevOpen.current && !open && anchorRef.current) {
      anchorRef.current.focus();
    }
    prevOpen.current = open;
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    try {
      await axiosInstance.post('/api/v1/auth/logout');
    } catch {
      // non-fatal
    } finally {
      logout();
      navigate('/login');
    }
  };

  const handleClose = (e: MouseEvent | TouchEvent) => {
    if (anchorRef.current?.contains(e.target as Node)) return;
    setOpen(false);
  };

  const initial = (user?.email?.[0] ?? 'U').toUpperCase();
  const displayName = user?.first_name
    ? `${user.first_name}${user.first_name ? ' ' + user.last_name : ''}`
    : user?.email ?? 'Account';

  return (
    <>
      {/* AVATAR TRIGGER */}
      <Box
        ref={anchorRef}
        onClick={() => setOpen(prev => !prev)}
        sx={{
          width: 32, height: 32, borderRadius: '50%',
          bgcolor: alpha(theme.palette.primary.main, 0.15),
          border: `1.5px solid ${open ? theme.palette.primary.main : 'var(--rule)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
          transition: 'border-color 0.15s',
          '&:hover': { borderColor: theme.palette.primary.main },
        }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.palette.primary.main, lineHeight: 1 }}>
          {initial}
        </Typography>
      </Box>

      {/* POPPER */}
      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-end"
        transition
        disablePortal
        popperOptions={{ modifiers: [{ name: 'offset', options: { offset: [0, 8] } }] }}
        sx={{ zIndex: 1300 }}
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleClose}>
            <Transitions type="fade" in={open} {...TransitionProps} transformOriginPosition="top">
              <Paper sx={{
                boxShadow: theme.shadows[8],
                border: '0.5px solid var(--rule)',
                borderRadius: '10px',
                bgcolor: 'var(--surface)',
                minWidth: 220,
                overflow: 'hidden',
              }}>
                {/* IDENTITY */}
                <Box sx={{ px: 2, pt: 1.75, pb: 1.25 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
                    {displayName}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: '2px' }}>
                    {user?.email}
                  </Typography>
                </Box>

                <Divider sx={{ borderColor: 'var(--rule)' }} />

                {/* ACTIONS */}
                <List disablePadding sx={{ py: 0.5 }}>
                  <ListItemButton
                    onClick={() => { setOpen(false); navigate('/settings'); }}
                    sx={{ px: 2, py: 0.875, gap: 1.25, '&:hover': { bgcolor: 'var(--bg-2)' }, borderRadius: 0 }}
                  >
                    <ListItemIcon sx={{ minWidth: 0, color: 'var(--ink-3)' }}>
                      <Settings size={15} strokeWidth={1.75} />
                    </ListItemIcon>
                    <ListItemText
                      primary={<Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>Settings</Typography>}
                    />
                  </ListItemButton>

                  <ListItemButton
                    onClick={handleLogout}
                    sx={{ px: 2, py: 0.875, gap: 1.25, '&:hover': { bgcolor: 'var(--bg-2)' }, borderRadius: 0 }}
                  >
                    <ListItemIcon sx={{ minWidth: 0, color: 'var(--ink-3)' }}>
                      <LogOut size={15} strokeWidth={1.75} />
                    </ListItemIcon>
                    <ListItemText
                      primary={<Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>Log out</Typography>}
                    />
                  </ListItemButton>
                </List>
              </Paper>
            </Transitions>
          </ClickAwayListener>
        )}
      </Popper>
    </>
  );
};

export default ProfileSection;
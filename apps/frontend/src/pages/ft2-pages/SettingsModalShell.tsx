// apps/frontend/src/pages/ft2-pages/SettingsModalShell.tsx
//
// SETTINGS MODAL SHELL — ISS-269
// --------------------------------
// Settings remain URL-addressable, but render over the route the user was
// working in. The return location is carried through settings navigation so
// close, Escape, and backdrop-click restore that exact application context.

import {
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CreditCard,
  DollarSign,
  FileText,
  Languages,
  Plug,
  Search,
  Settings,
  Truck,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import { SETTINGS_TABS } from './settingsTabs';

interface SettingsReturnLocation {
  pathname: string;
  search: string;
  hash: string;
  state?: unknown;
}

interface SettingsModalShellProps {
  children: ReactNode;
  returnLocation?: SettingsReturnLocation | null;
}

const SETTINGS_ICONS: Record<string, LucideIcon> = {
  general: Settings,
  carriers: Truck,
  warehouse: Warehouse,
  finance: DollarSign,
  localization: Languages,
  notifications: Bell,
  integrations: Plug,
  billing: CreditCard,
  reports: FileText,
  team: Users,
};

export default function SettingsModalShell({
  children,
  returnLocation,
}: SettingsModalShellProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return SETTINGS_TABS;

    return SETTINGS_TABS.filter((item) =>
      item.label.toLowerCase().includes(normalizedQuery)
    );
  }, [query]);

  const handleClose = () => {
    if (returnLocation) {
      const returnPath =
        `${returnLocation.pathname}${returnLocation.search}${returnLocation.hash}`;

      navigate(returnPath, {
        replace: true,
        state: returnLocation.state,
      });
      return;
    }

    navigate('/overview', { replace: true });
  };

  const handleNavigate = (path: string) => {
    if (returnLocation) {
      navigate(path, {
        state: { backgroundLocation: returnLocation },
      });
      return;
    }

    navigate(path);
  };

  const isActive = (path: string) => {
    if (path === '/team') {
      return pathname === '/team' || pathname.startsWith('/team/');
    }

    return pathname === path;
  };

  return (
    <Dialog
      open
      maxWidth={false}
      aria-label="Shop settings"
      onClose={handleClose}
      slotProps={{
        backdrop: {
          sx: {
            bgcolor: 'rgba(5, 8, 13, 0.66)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
          },
        },
        paper: {
          sx: {
            m: { xs: 1.5, sm: 3 },
            width: {
              xs: 'calc(100% - 24px)',
              sm: 'calc(100% - 48px)',
            },
            maxWidth: '1320px',
            height: {
              xs: 'calc(100% - 24px)',
              sm: 'calc(100% - 48px)',
            },
            maxHeight: '1000px',
            overflow: 'hidden',
            borderRadius: '14px',
            border: '1px solid var(--rule)',
            bgcolor: 'var(--surface)',
            backgroundImage: 'none',
            boxShadow: '0 24px 80px rgba(0, 0, 0, 0.38)',
          },
        },
      }}
    >
      <Box sx={{ height: '100%', minHeight: 0, display: 'flex' }}>
        <Box
          component="aside"
          sx={{
            width: { xs: 76, sm: 250 },
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'var(--bg)',
            borderRight: '1px solid var(--rule)',
          }}
        >
          <Box sx={{ p: { xs: 1.25, sm: 2 } }}>
            <Typography
              sx={{
                display: { xs: 'none', sm: 'block' },
                mb: 1.5,
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              Settings
            </Typography>

            <Box
              component="label"
              sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 1,
                height: 38,
                px: 1.25,
                borderRadius: '8px',
                border: '1px solid var(--rule)',
                bgcolor: 'var(--surface)',
                color: 'var(--ink-4)',
                '&:focus-within': {
                  borderColor: 'var(--ink-3)',
                  color: 'var(--ink-3)',
                },
              }}
            >
              <Search size={16} strokeWidth={1.75} />

              <Box
                component="input"
                value={query}
                autoComplete="off"
                aria-label="Search settings"
                placeholder="Search"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setQuery(event.target.value)
                }
                sx={{
                  minWidth: 0,
                  width: '100%',
                  border: 0,
                  outline: 0,
                  bgcolor: 'transparent',
                  color: 'var(--ink)',
                  font: 'inherit',
                  fontSize: 13,
                  '&::placeholder': {
                    color: 'var(--ink-4)',
                    opacity: 1,
                  },
                }}
              />
            </Box>
          </Box>

          <Typography
            sx={{
              display: { xs: 'none', sm: 'block' },
              px: 2,
              pb: 0.75,
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--ink-4)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Shop settings
          </Typography>

          <Box
            component="nav"
            aria-label="Settings sections"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              px: { xs: 1, sm: 1.25 },
              pb: 2,
            }}
          >
            {filteredItems.map((item) => {
              const Icon = SETTINGS_ICONS[item.id] ?? Settings;
              const active = isActive(item.path);

              return (
                <Box
                  key={item.id}
                  component="button"
                  type="button"
                  title={item.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => handleNavigate(item.path)}
                  sx={{
                    width: '100%',
                    minHeight: 40,
                    mb: '2px',
                    px: { xs: 0, sm: 1.25 },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: {
                      xs: 'center',
                      sm: 'flex-start',
                    },
                    gap: 1.25,
                    border: 0,
                    borderRadius: '8px',
                    bgcolor: active ? 'var(--bg-3)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    transition: 'background 0.12s, color 0.12s',
                    '&:hover': {
                      bgcolor: 'var(--bg-2)',
                      color: 'var(--ink)',
                    },
                  }}
                >
                  <Icon size={17} strokeWidth={1.75} />

                  <Typography
                    sx={{
                      display: { xs: 'none', sm: 'block' },
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      color: 'inherit',
                    }}
                  >
                    {item.label}
                  </Typography>
                </Box>
              );
            })}

            {filteredItems.length === 0 && (
              <Typography
                sx={{
                  display: { xs: 'none', sm: 'block' },
                  px: 1.25,
                  py: 2,
                  fontSize: 12,
                  color: 'var(--ink-4)',
                }}
              >
                No settings found.
              </Typography>
            )}
          </Box>
        </Box>

        <Box
          component="section"
          sx={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            bgcolor: 'var(--surface)',
          }}
        >
          <IconButton
            aria-label="Close settings"
            onClick={handleClose}
            size="small"
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 2,
              color: 'var(--ink-3)',
              bgcolor: 'var(--surface)',
              '&:hover': {
                bgcolor: 'var(--bg-2)',
                color: 'var(--ink)',
              },
            }}
          >
            <X size={19} strokeWidth={1.75} />
          </IconButton>

          <Box
            sx={{
              height: '100%',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              scrollbarGutter: 'stable',
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx
import React from "react";
import { useLocation, Link as RouterLink } from "react-router-dom";
import {
  Box,
  IconButton,
  Typography,
  Breadcrumbs as MuiBreadcrumbs,
  Link,
  Tooltip
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import IconComponent from "../../components/Icon";
import { TrialCountdownChip } from 'components/TrialCountdownChip';

import { Bell, Home } from 'lucide-react';
import { Badge } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../../pages/alerts/useAlerts';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useIntegration } from '../../contexts/integration/useIntegration';

interface TopnavbarContentProps {
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
  onToggleSidenav: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({
  onToggleSidenav
}) => {
  const location = useLocation();
  const { mode, setMode } = useColorScheme();
  const { phase } = useShopLifecycle();
  const isFt2 = phase === 'FT2_READY';

  const navigate = useNavigate();
  const { data: alertsData } = useAlerts();
  const unreadAlerts = alertsData?.data?.length ?? 0;
   const { isSyncComplete } = useIntegration();
  const isLive = isSyncComplete;

  const pathnames = location.pathname.split("/").filter((x) => x);
  const capitalize = (s: string) =>
    s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <Box
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px"
      }}
    >
      {/* LEFT SIDE */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          flex: "1 1 auto",
          overflow: "hidden"
        }}
      >

        {/* LOGO — switches between light/dark asset based on color scheme */}
        <Box
          component="img"
          src={mode === 'dark' ? '/logo-dark.png' : '/logo.png'}
          alt="LaSyncro"
          sx={{ height: 22, width: 'auto', display: 'block', mr: 2, ml: 1, flexShrink: 0 }}
        />

       <MuiBreadcrumbs
          aria-label="breadcrumb"
          sx={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}
        >
          {/* Home icon anchor */}
          <Link component={RouterLink} to="/" underline="none" sx={{ display: 'flex', alignItems: 'center', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}>
            <Home size={14} strokeWidth={1.75} />
          </Link>

          {/* Workspace static crumb — always present in FT2 */}
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>Workspace</Typography>

          {/* Dynamic path segments — last segment in brand orange */}
          {pathnames.map((value, index) => {
            const last = index === pathnames.length - 1;
            const to = `/${pathnames.slice(0, index + 1).join("/")}`;
            const label = capitalize(value.replace(/-/g, " "));
            return last ? (
              <Typography key={to} sx={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>
                {label}
              </Typography>
            ) : (
              <Link key={to} component={RouterLink} to={to} underline="hover" sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
                {label}
              </Link>
            );
          })}
        </MuiBreadcrumbs>
      </Box>

     <Box sx={{ flex: "0 0 16px" }} />

      {/* RIGHT SIDE */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        sx={{
          flexShrink: 0,
          whiteSpace: "nowrap",
          ml: "auto"
        }}
      >

    {isFt2 && (
          <>
        <Tooltip title="Alerts">
          <IconButton
            size="small"
            onClick={() => navigate('/alerts')}
            sx={{ color: unreadAlerts > 0 ? 'var(--accent)' : 'text.secondary' }}
          >
            <Badge
              badgeContent={unreadAlerts > 0 ? unreadAlerts : undefined}
              max={99}
              color="error"
              sx={{ '& .MuiBadge-badge': { fontSize: 9, minWidth: 16, height: 16 } }}
            >
              <Bell size={18} strokeWidth={unreadAlerts > 0 ? 2.5 : 1.75} />
            </Badge>
          </IconButton>
        </Tooltip>
        
        {/* Trial Countdown Chip */}
        <TrialCountdownChip />

        <Tooltip title="Light mode">
          <IconButton
            size="small"
            onClick={() => setMode("light")}
            sx={{
              color:
                mode === "light"
                  ? "primary.main"
                  : "text.secondary"
            }}
          >
            <IconComponent name="Sun" size="medium" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Dark mode">
          <IconButton
            size="small"
            onClick={() => setMode("dark")}
            sx={{
              color:
                mode === "dark"
                  ? "primary.main"
                  : "text.secondary"
            }}
          >
            <IconComponent name="Moon" size="medium" />
          </IconButton>
        </Tooltip>
        </>
      )}

        {/* SYNC STATUS PILL */}
        {isFt2 && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.6,
            px: 1.25, py: 0.375,
            borderRadius: '20px',
            bgcolor: isLive ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
            border: `0.5px solid ${isLive ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
            flexShrink: 0,
          }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              bgcolor: isLive ? '#22C55E' : '#F59E0B',
              boxShadow: isLive ? '0 0 4px rgba(34,197,94,0.6)' : '0 0 4px rgba(245,158,11,0.6)',
            }} />
            <Typography sx={{ fontSize: 11, fontWeight: 500, color: isLive ? '#22C55E' : '#F59E0B', lineHeight: 1, whiteSpace: 'nowrap' }}>
              {isLive ? 'Live' : 'Syncing'}
            </Typography>
          </Box>
        )}
        
      </Box>
    </Box>
  );
};

export default TopnavbarContent;

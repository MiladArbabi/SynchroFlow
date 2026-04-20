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
  Tooltip,
  useTheme
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import IconComponent from "../../components/Icon";
import { TrialCountdownChip } from 'components/TrialCountdownChip';

import ProfileSection from "layout/MainLayout/Header/ProfileSection";

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
  const theme = useTheme();
  const { mode, setMode } = useColorScheme();

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
        <IconButton onClick={onToggleSidenav} size="small" disableRipple>
          <IconComponent name="PanelLeft" size="medium" color="inherit" />
        </IconButton>

        <MuiBreadcrumbs
          aria-label="breadcrumb"
          sx={{
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis"
          }}
        >
          <Link
            component={RouterLink}
            underline="hover"
            color="inherit"
            to="/"
          />

          {pathnames.map((value, index) => {
            const last = index === pathnames.length - 1;
            const to = `/${pathnames
              .slice(0, index + 1)
              .join("/")}`;

            return last ? (
              <Typography color="text.primary" key={to}>
                {capitalize(value.replace("-", " "))}
              </Typography>
            ) : (
              <Link
                component={RouterLink}
                underline="hover"
                color="inherit"
                to={to}
                key={to}
              >
                {capitalize(value.replace("-", " "))}
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

        <ProfileSection />
        
      </Box>
    </Box>
  );
};

export default TopnavbarContent;

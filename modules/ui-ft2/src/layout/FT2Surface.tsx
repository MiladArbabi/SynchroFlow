import {
  Box,
  Paper,
  IconButton,
} from '@mui/material';

import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import OpenInFullOutlinedIcon from '@mui/icons-material/OpenInFullOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';

import { FT2_TOKENS } from './tokens';

export type FT2SurfaceVariant = 'standard' | 'kpi';

export type FT2SurfaceProps = {
  children?: React.ReactNode;
  title?: string;
  variant?: FT2SurfaceVariant;
  width?: any;
};

export function FT2Surface({
  children,
  title,
  variant = 'standard',
  width,
}: FT2SurfaceProps) {
  const padding =
    variant === 'kpi'
      ? FT2_TOKENS.surfacePadding.kpi
      : FT2_TOKENS.surfacePadding.standard;

  return (
    <Paper
      elevation={0}
      data-ft2-surface
      data-ft2-variant={variant}
      sx={{
        width: width || '100%',
        mx: width ? 'auto' : undefined,
      }}
    >
      {/* Control Zone */}
      <Box
        sx={{
          height: FT2_TOKENS.controlZoneHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: padding / 8,
        }}
      >
        <Box data-ft2-surface-title>{title}</Box>

        <Box>
          <IconButton size="small">
            <InfoOutlinedIcon fontSize="inherit" />
          </IconButton>
          <IconButton size="small">
            <SettingsOutlinedIcon fontSize="inherit" />
          </IconButton>
          <IconButton size="small">
            <OpenInFullOutlinedIcon fontSize="inherit" />
          </IconButton>
          <IconButton size="small">
            <DownloadOutlinedIcon fontSize="inherit" />
          </IconButton>
          <IconButton size="small">
            <MoreVertOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Box>
      </Box>

      {/* Content */}
      <Box
        data-ft2-surface-content
        sx={{
          px: padding / 8,
          pb: padding / 8,
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

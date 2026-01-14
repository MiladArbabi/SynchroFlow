import {
  Box,
  Paper,
  IconButton,
} from '@mui/material';
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

        height: '100%',
        display: 'flex',
        flexDirection: 'column',

        overflow: 'hidden',     // ⬅️ HARD CLIP
      }}
    >
      {/* ───── Control Zone (fixed) ───── */}
      <Box
        sx={{
          height: FT2_TOKENS.controlZoneHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: padding / 8,
          flexShrink: 0,              // ⬅️ never collapse
        }}
      >
        <Box data-ft2-surface-title>{title}</Box>

        <Box>
          <IconButton size="small">
            <MoreVertOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Box>
      </Box>

      {/* ───── Content Zone (flex-fill) ───── */}
      <Box
        data-ft2-surface-content
        sx={{
          px: padding / 8,
          pb: padding / 8,

          flex: 1,                    // ⬅️ fills remaining height
          minHeight: 0,               // ⬅️ allows charts to shrink
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

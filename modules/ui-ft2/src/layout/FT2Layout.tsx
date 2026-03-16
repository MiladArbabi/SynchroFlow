import { Box } from '@mui/material';
import { FT2_TOKENS } from './ft2.tokens.js';

export type FT2LayoutProps = {
  children: React.ReactNode;
};

export function FT2Layout({ children }: FT2LayoutProps) {
  return (
    <Box
      data-ft2-layout
      sx={{
        /**
         * CONTROL TOWER FRAME
         * -------------------
         * FT2 dashboards operate inside a deterministic
         * application frame independent of navigation width.
         *
         * This prevents sidenav expansion from altering
         * the Control Tower layout geometry.
         */
        width: FT2_TOKENS.layoutMaxWidth,
        maxWidth: '100%',
        mx: 'auto',

        // 🔒 Global padding – symmetric and deterministic
        px: {
          xs: FT2_TOKENS.padding.mobile / 8,
          sm: FT2_TOKENS.padding.tablet / 8,
          md: FT2_TOKENS.padding.desktop / 8,
        },
        py: {
          xs: FT2_TOKENS.padding.mobile / 8,
          sm: FT2_TOKENS.padding.tablet / 8,
          md: FT2_TOKENS.padding.desktop / 8,
        },

        // Ensure full-height outlet participation
        minHeight: '100%',
      }}
    >
      <Box
        data-ft2-layout-column
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: FT2_TOKENS.rowGap / 8,

          justifyContent: 'flex-start',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}


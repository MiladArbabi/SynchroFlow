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
         * VIEWPORT-SAFE WIDTH CONTRACT
         * ----------------------------
         * Never force the FT2 surface wider than the available
         * application content frame (especially with sidenav open).
         *
         * maxWidth preserves the design cap.
         * width: '100%' guarantees viewport containment.
         */
        width: '100%',
        maxWidth: FT2_TOKENS.layoutMaxWidth,
        mx: 'auto',

        /**
         * AUDIT SIGNAL
         * ------------
         * Prevent hidden horizontal expansion.
         */
        overflowX: 'hidden',

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


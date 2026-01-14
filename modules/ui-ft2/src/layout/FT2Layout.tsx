import { Box } from '@mui/material';
import { FT2_TOKENS } from './tokens';

export type FT2LayoutProps = {
  children: React.ReactNode;
};

export function FT2Layout({ children }: FT2LayoutProps) {
  return (
    <Box
      data-ft2-layout
      sx={{
        maxWidth: FT2_TOKENS.layoutMaxWidth,
        mx: 'auto',
        px: {
          xs: FT2_TOKENS.padding.mobile / 8,
          sm: FT2_TOKENS.padding.tablet / 8,
          md: FT2_TOKENS.padding.desktop / 8,
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: FT2_TOKENS.rowGap / 8,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

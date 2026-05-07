// modules/shared/src/ui/ModuleLoadingSkeleton.tsx
//
// ModuleLoadingSkeleton
// ---------------------
// Standard loading placeholder for FT2 module pages.
// Replaces raw CircularProgress with a content-shaped skeleton.
//
// Usage:
//   Full page: <ModuleLoadingSkeleton />
//   Inline:    <ModuleLoadingSkeleton rows={1} height={20} />

import { Box, Skeleton } from '@mui/material';

interface ModuleLoadingSkeletonProps {
  rows?: number;
  height?: number;
}

export function ModuleLoadingSkeleton({ rows = 4, height = 24 }: ModuleLoadingSkeletonProps) {
  return (
    <Box sx={{ pt: 3, px: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          variant="rounded"
          height={height}
          width={i % 2 === 0 ? '80%' : '60%'}
          animation="wave"
        />
      ))}
    </Box>
  );
}
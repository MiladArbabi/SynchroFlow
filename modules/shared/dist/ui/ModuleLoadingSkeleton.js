import { jsx as _jsx } from "react/jsx-runtime";
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
export function ModuleLoadingSkeleton({ rows = 4, height = 24 }) {
    return (_jsx(Box, { sx: { pt: 3, px: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }, children: Array.from({ length: rows }).map((_, i) => (_jsx(Skeleton, { variant: "rounded", height: height, width: i % 2 === 0 ? '80%' : '60%', animation: "wave" }, i))) }));
}

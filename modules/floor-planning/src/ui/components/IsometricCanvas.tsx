// Re-export only. Canonical implementation lives in @lasyncro/shared/ui
// so the canvas never forks again. See themes/index.tsx for --zone-* tokens.
export {
  IsometricCanvas,
  IsometricZoneView,
} from '@lasyncro/shared/ui';
export type {
  IsometricCanvasProps,
  IsometricZoneViewProps,
} from '@lasyncro/shared/ui';
// apps/frontend/src/activation/ActivationSurfaceAdapter.tsx
import ActivationSurfacePage from './ActivationSurfacePage';
import type { ActivationSurfaceProps } from '@lasyncro/shared/ui/activation';

interface Props {
  surface: ActivationSurfaceProps;
  onAction: (actionId: string) => void;
}

export function ActivationSurfaceAdapter({ surface, onAction }: Props) {
  return (
    <ActivationSurfacePage
      config={{
        ...surface,
        onAction,
      }}
      onActivate={() => {
        if (!surface.primaryCTA) return;
        onAction(surface.primaryCTA.actionId);
      }}
    />
  );
}
    
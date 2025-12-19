// apps/frontend/src/activation/ActivationSurfaceAdapter.tsx
import ActivationSurfacePage from './ActivationSurfacePage';
import { ActivationSurfaceProps } from '@lasyncro/shared/src/ui/activation/types';

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
      onActivate={() => onAction(surface.primaryCTA.actionId)}
    />
  );
}
    
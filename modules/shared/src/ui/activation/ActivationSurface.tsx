//modules/shared/src/ui/activation/ActivationSurface.tsx

import React from 'react';

export interface ActivationSurfaceProps {
  moduleId: string;
  integrationProvider: string;
}

export const ActivationSurface: React.FC<ActivationSurfaceProps> = ({
  moduleId
}) => {
  return (
    <section data-testid="activation-surface">
      <h1>{moduleId}</h1>

      <div data-testid="activation-vision-preview">
        {/* FT-1 Vision Preview placeholder */}
      </div>

      <div data-testid="activation-connect-integration">
        {/* FT-1 Integration CTA placeholder */}
      </div>
    </section>
  );
};

//modules/shared/src/ui/activation/ActivationSurface.tsx

import React from 'react';

export interface ActivationSurfaceProps {
  moduleId: string;
  integrationProvider?: string;
  integrationCTA?: React.ReactNode;
  headline?: string;
  description?: string;
}

export const ActivationSurface: React.FC<ActivationSurfaceProps> = ({
  moduleId,
  integrationProvider,
  integrationCTA, 
  headline,
  description
}) => {
  return (
    <section data-testid="activation-surface">
      <h1>{headline ?? moduleId}</h1>

      {description && (
        <p data-testid="activation-description">
          {description}
        </p>
      )}

      <div data-testid="activation-vision-preview">
        {/* FT-1 Vision Preview placeholder */}
      </div>

      <div data-testid="activation-connect-integration">
        {integrationCTA}
      </div>
    </section>
  );
};

//apps/frontend/src/shells/CommercePageShell.tsx

import React from 'react';
import { CommerceFT1Gate } from 'activation/FT1ActivationGate';

interface CommercePageShellProps {
  moduleId: string;
  children: React.ReactNode;
}

export function CommercePageShell({
  moduleId,
  children
}: CommercePageShellProps) {
  return (
    <CommerceFT1Gate moduleId={moduleId}>
      {children}
    </CommerceFT1Gate>
  );
}
//apps/frontend/src/shells/CommercePageShell.tsx

import React from 'react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

interface CommercePageShellProps {
  moduleId: string;
  children: React.ReactNode;
}

export function CommercePageShell({
  moduleId,
  children
}: CommercePageShellProps) {
  return (
    <CommerceActivationGate moduleId={moduleId}>
      {children}
    </CommerceActivationGate>
  );
}
// apps/frontend/src/pages/DashboardFT2Page.tsx
//
// DashboardFT2Page
// ----------------
// FT2-only dashboard surface.
//
// HARD CONTRACT:
// - MUST render FT2 observability surfaces only
// - MUST NOT render FT1 modules or onboarding CTAs
// - MUST NOT read lifecycle state
// - MUST assume FT2 routing is authoritative
//
// NOTE:
// This is intentionally a skeleton.
// FT2 dashboard composition will be added later.

import React from 'react';

const __DEV__ = import.meta.env.DEV;

const DashboardFT2Page: React.FC = () => {
  if (__DEV__) {
    console.debug('[MOUNT] DashboardFT2Page');
  }

  return (
    <div>
      {/* FT2 Dashboard placeholder */}
      <p>Dashboard insights will appear here.</p>
    </div>
  );
};

export default DashboardFT2Page;
// tests/unit/ui/routing/ProtectedRoute.role-admission.test.tsx
//
// INVENTORY INTELLIGENCE RED-D — protects EXISTING operator route admission.
//
// ProtectedRoute wraps every authenticated application route (App.tsx `/*`).
// OPERATOR ROUTE GUARD (WM-31): an operator on any path outside /wms is
// redirected to /wms and the protected child for that path never renders.
// Owner / Admin are admitted. This is the canonical behaviour — no separate
// Not Authorized screen exists or is introduced here.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ProtectedRoute from 'components/ProtectedRoute';

let mockRole: 'owner' | 'admin' | 'operator' = 'owner';

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    isLoading: false,
    accessToken: 'test-token',
    user: { id: 1, shop_id: 1, role: mockRole },
  }),
}));

/** The protected child reports the path it rendered for. */
function ProtectedChild() {
  const location = useLocation();
  return <div data-testid="protected-child">{location.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <ProtectedChild />
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute — OPERATOR is redirected to /wms (WM-31)', () => {
  beforeEach(() => {
    mockRole = 'operator';
  });

  it.each(['/inventory', '/inventory/catalog', '/overview', '/orders', '/floor-planning'])(
    '%s → /wms; the protected child never renders for the requested path',
    (path) => {
      renderAt(path);

      const child = screen.getByTestId('protected-child');
      expect(child).toHaveTextContent('/wms');
      expect(screen.queryByText(path)).toBeNull();
      expect(screen.getAllByTestId('protected-child')).toHaveLength(1);
    }
  );

  it('/wms is admitted and the protected child renders', () => {
    renderAt('/wms');

    expect(screen.getByTestId('protected-child')).toHaveTextContent('/wms');
  });
});

describe('ProtectedRoute — OWNER and ADMIN are admitted to /inventory', () => {
  it.each(['owner', 'admin'] as const)('%s → /inventory renders the protected child', (role) => {
    mockRole = role;
    renderAt('/inventory');

    expect(screen.getByTestId('protected-child')).toHaveTextContent('/inventory');
  });
});

// ---------------------------------------------------------------------------
// GH-1222 / TIER-07 — ratified operator route-admission matrix.
//
// Problem Center is an operational surface: operators enter /problem-center.
// Floor Planning and Warehouse Analytics are owner/admin management surfaces:
// operators are redirected to /wms (no Not Authorized screen). Backend
// requireAction remains the authority; this is UX admission only.
// ---------------------------------------------------------------------------

describe('GH-1222 C — OPERATOR Warehouse admission matrix', () => {
  beforeEach(() => {
    mockRole = 'operator';
  });

  it.each([
    ['C1 GREEN CONTROL', '/wms'],
    ['C2 GREEN CONTROL', '/wms/pick'],
    ['C3 EXPECTED RED', '/problem-center'],
  ])('%s: operator %s is admitted and the protected child renders for it', (_id, path) => {
    renderAt(path);

    expect(screen.getByTestId('protected-child')).toHaveTextContent(path);
  });

  it.each([
    ['C4 GREEN CONTROL', '/floor-planning'],
    ['C5 EXPECTED RED', '/wms/analytics'],
  ])('%s: operator %s is redirected to /wms', (_id, path) => {
    renderAt(path);

    const child = screen.getByTestId('protected-child');
    expect(child.textContent).toBe('/wms');
    expect(screen.getAllByTestId('protected-child')).toHaveLength(1);
  });
});

describe('GH-1222 C — OWNER / ADMIN Warehouse admission unchanged', () => {
  it.each(['owner', 'admin'] as const)(
    'GREEN CONTROL: %s is admitted to every Warehouse surface',
    (role) => {
      mockRole = role;
      for (const path of ['/wms', '/floor-planning', '/wms/analytics', '/problem-center']) {
        const { unmount } = renderAt(path);
        expect(screen.getByTestId('protected-child')).toHaveTextContent(path);
        unmount();
      }
    }
  );
});

import { screen } from '@testing-library/react';
import { AnalyticsModuleFT2 } from '@lasyncro/analytics';
import { renderWithTheme } from 'test-utils';

describe('AnalyticsModuleFT2 (UI)', () => {
  test('renders null observability honestly', () => {
    renderWithTheme(
      <AnalyticsModuleFT2
        snapshot={{ id: 's1', extractedAt: 'now' }}
        domains={{
          orders: null,
          products: null,
          customers: null,
          finances: null,
        }}
      />
    );

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  test('does not render outcome, trend, or insights', () => {
    renderWithTheme(
      <AnalyticsModuleFT2
        snapshot={{ id: 's1', extractedAt: 'now' }}
        domains={{
          orders: {
            presence: true,
            observationCount: 5,
            nullSurface: 0,
            firstSeenAt: 'a',
            lastSeenAt: 'b',
          },
          products: null,
          customers: null,
          finances: null,
        }}
      />
    );

    expect(screen.queryByText(/outcome/i)).toBeNull();
    expect(screen.queryByText(/trend/i)).toBeNull();
    expect(screen.queryByText(/insight/i)).toBeNull();
  });
});
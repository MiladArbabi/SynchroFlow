import { render } from '@testing-library/react';
import SyncSurfacePage from 'activation/SyncSurfacePage';

describe('SyncSurfacePage — FT-0 snapshot', () => {
  it('renders stable FT-0 structure', () => {
    const { container } = render(
      <SyncSurfacePage
        moduleTitle="Orders"
        syncStatus="SYNCING_PRODUCTS"
        progress={{ current: 3, total: 10, percentage: 30 }}
      />
    );

    expect(container).toMatchSnapshot();
  });
});

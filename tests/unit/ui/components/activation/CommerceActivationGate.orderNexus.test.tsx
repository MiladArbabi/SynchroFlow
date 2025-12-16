import { render } from '@testing-library/react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

// Mock IntegrationContext → not integrated
jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: () => ({
    hasIntegrations: false,
  }),
}));

// Mock ConnectStore components (not under test)
jest.mock('components/ConnectStoreBanner', () => ({
  ConnectStoreBanner: ({ onOpenModal }: any) => (
    <button onClick={onOpenModal}>Connect</button>
  ),
}));

jest.mock('components/ConnectStoreModal', () => ({
  ConnectStoreModal: () => null,
}));

describe('CommerceActivationGate — OrderNexus activation', () => {
  it('renders OrderNexus ActivationSurface without legacy props or runtime errors', () => {
    expect(() =>
      render(
        <CommerceActivationGate moduleId="order-nexus">
          <div>Orders Live Content</div>
        </CommerceActivationGate>
      )
    ).not.toThrow();
  });
});

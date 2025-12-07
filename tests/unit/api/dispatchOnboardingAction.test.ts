// tests/unit/api/dispatchOnboardingAction.test.ts
import { dispatchOnboardingAction } from '../../../apps/frontend/src/onboarding/dispatchOnboardingAction';
import type { OnboardingAction } from '@lasyncro/shared';

describe('dispatchOnboardingAction', () => {
  const navigate = jest.fn();
  const openModal = jest.fn();

  const handlers = { navigate, openModal };

  beforeEach(() => {
    navigate.mockReset();
    openModal.mockReset();
  });

  it('does nothing when action is undefined', () => {
    dispatchOnboardingAction(undefined, handlers);
    expect(navigate).not.toHaveBeenCalled();
    expect(openModal).not.toHaveBeenCalled();
  });

  it('calls navigate for type="navigate" with target', () => {
    const action: OnboardingAction = {
      type: 'navigate',
      target: '/settings/cost-model',
    };

    dispatchOnboardingAction(action, handlers);

    expect(navigate).toHaveBeenCalledWith('/settings/cost-model');
    expect(openModal).not.toHaveBeenCalled();
  });

  it('calls openModal for type="openModal" with target', () => {
    const action: OnboardingAction = {
      type: 'openModal',
      target: 'connect-store',
    };

    dispatchOnboardingAction(action, handlers);

    expect(openModal).toHaveBeenCalledWith('connect-store');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens external URL in a new tab for type="openExternal"', () => {
    // In the Node test environment, there is no real window object,
    // so we create a minimal shim with an open() function we can assert on.
    const openMock = jest.fn();
    (global as any).window = { open: openMock };

    const action: OnboardingAction = {
        type: 'openExternal',
        target: 'https://example.com'
    };

    dispatchOnboardingAction(action, handlers);

    expect(openMock).toHaveBeenCalledWith(
        'https://example.com',
        '_blank',
        'noopener,noreferrer'
    );
});


  it('handles missing target by doing nothing', () => {
    const action: OnboardingAction = {
      type: 'navigate',
    };

    dispatchOnboardingAction(action, handlers);

    expect(navigate).not.toHaveBeenCalled();
    expect(openModal).not.toHaveBeenCalled();
  });
});

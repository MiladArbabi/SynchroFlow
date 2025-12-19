//tests/unit/ui/activation/activation-mapper.test.ts
import { mapActivationVerdictToUIState } from '@lasyncro/shared/ui/activation/activation-mapper';
import { ActivationVerdict } from '@lasyncro/shared/contracts/activation';
import { ActivationSurfaceProps } from '@lasyncro/shared/ui/activation/types';

const baseSurface: ActivationSurfaceProps = {
  moduleId: 'order-nexus',
  identity: {
    title: 'Orders',
    subtitle: 'Hidden profit loss',
  },
  blindness: {
    subject: 'Order 4832',
    dimension: 'net margin',
    status: 'unknown',
  },
  primaryCTA: {
    label: 'Connect Store',
    actionId: 'connect-store',
  },
  trust: {
    bullets: ['Read-only access'],
  },
};

describe('mapActivationVerdictToUIState', () => {
  test('maps BLOCKED verdict to BLOCKED UI state with original surface', () => {
    const verdict: ActivationVerdict = {
      verdict: 'BLOCKED',
      reason: 'NOT_CONNECTED',
    };

    const uiState = mapActivationVerdictToUIState(verdict, baseSurface);

    expect(uiState).toEqual({
      state: 'BLOCKED',
      surface: baseSurface,
    });
  });

  test('maps INTEGRATION_COMPLETE_NOT_READY to BLOCKED with overridden subtitle', () => {
    const verdict: ActivationVerdict = {
      verdict: 'INTEGRATION_COMPLETE_NOT_READY',
      blockingModules: ['order-nexus'],
    };

    const uiState = mapActivationVerdictToUIState(verdict, baseSurface);

    expect(uiState.state).toBe('BLOCKED');

    if (uiState.state === 'BLOCKED') {
    expect(uiState.surface.identity?.subtitle).toBe(
        'Finish setup to unlock this module'
    );

    expect(uiState.surface.identity?.title).toBe('Orders');
    }

  });

  test('maps ACTIVE verdict to ACTIVE UI state', () => {
    const verdict: ActivationVerdict = {
      verdict: 'ACTIVE',
      activatedModules: ['order-nexus'],
    };

    const uiState = mapActivationVerdictToUIState(verdict, baseSurface);

    expect(uiState).toEqual({
      state: 'ACTIVE',
      active: true,
    });
  });
});
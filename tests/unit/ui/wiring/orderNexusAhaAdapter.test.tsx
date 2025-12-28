//tests/unit/ui/wiring/orderNexusAhaAdapter.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';
import * as focus from 'activation/ft1ChecklistFocus';

describe('useOrderNexusAhaAdapter', () => {
  it('sets checklist focus and opens checklist on START_ONBOARDING', () => {
    const setFocusSpy = jest.spyOn(focus, 'setFt1ChecklistFocus');

    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    const { result } = renderHook(() => useOrderNexusAhaAdapter());

    act(() => {
      result.current({
        type: 'START_ONBOARDING',
        taskId: 'add-costs',
      });
    });

    expect(setFocusSpy).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      taskId: 'add-costs',
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ft1-checklist:open',
      })
    );
  });
});
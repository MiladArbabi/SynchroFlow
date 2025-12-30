/** @jest-environment jsdom */
// tests/unit/ui/wiring/specterChecklistFocus.test.ts

import * as focus from 'activation/ft1ChecklistFocus';
import { renderHook } from '@testing-library/react';
import { useSpecterChecklistAdapter } from 'wiring/specterChecklistAdapter';

describe('Specter checklist focus adapter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sets FT1 checklist focus to specter module and install-sdk task', () => {
    const setFocusSpy = jest.spyOn(focus, 'setFt1ChecklistFocus');

    const { result } = renderHook(() => useSpecterChecklistAdapter());

    result.current({
      type: 'START_ONBOARDING',
      taskId: 'install-sdk',
    });

    expect(setFocusSpy).toHaveBeenCalledWith({
      moduleId: 'specter',
      taskId: 'install-sdk',
    });
  });

  it('ignores unrelated intents', () => {
    const setFocusSpy = jest.spyOn(focus, 'setFt1ChecklistFocus');

    const { result } = renderHook(() => useSpecterChecklistAdapter());

    result.current({
      type: 'UNKNOWN_INTENT',
    } as any);

    expect(setFocusSpy).not.toHaveBeenCalled();
  });
});

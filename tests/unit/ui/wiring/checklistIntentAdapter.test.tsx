//tests/unit/ui/wiring/checklistIntentAdapter.test.ts
import { renderHook } from '@testing-library/react';
import { useChecklistIntentAdapter } from 'wiring/checklistIntentAdapter';

// ---- mock analytics hook ----
const mockEmit = jest.fn();

jest.mock('analytics/useUiEvents', () => ({
  useUiEvents: () => ({
    emit: mockEmit,
  }),
}));

describe('Checklist intent adapter → analytics', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps TASK_CLICK intent to ui.intent analytics event', () => {
    const { result } = renderHook(() => useChecklistIntentAdapter());

    result.current({
      type: 'TASK_CLICK',
      moduleId: 'order-nexus',
      taskId: 'sync-orders',
    });

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith({
      event: 'ui.intent',
      payload: {
        action: 'task_click:sync-orders',
        surface: 'ft1_checklist',
        moduleId: 'order-nexus',
        taskId: "sync-orders"
      },
    });
  });

  it('does not leak lifecycle or entitlement metadata', () => {
    const { result } = renderHook(() => useChecklistIntentAdapter());

    result.current({
      type: 'TASK_CLICK',
      moduleId: 'order-nexus',
      taskId: 'sync-orders',
    });

    const call = mockEmit.mock.calls[0][0];

    expect(call.payload.phase).toBeUndefined();
    expect(call.payload.entitlement).toBeUndefined();
    expect(call.payload.ft).toBeUndefined();
  });
});

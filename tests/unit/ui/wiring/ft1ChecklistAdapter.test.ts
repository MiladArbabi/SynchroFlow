// tests/unit/ui/wiring/ft1ChecklistAdapter.test.ts

import { mapFt1Checklist } from 'wiring/ft1ChecklistAdapter';

describe('FT1 Checklist Adapter', () => {
  it('maps backend readiness modules into checklist modules', () => {
    const readinessSnapshot = {
      shopId: 1,
      modules: [
        {
          moduleId: 'specter',
          displayName: 'Customer & Conversion (Specter)',
          isReady: false,
          signals: [
            { name: 'specter.sessionsKnown', value: true },
            { name: 'specter.sessionCount', value: 0 },
          ],
          tasks: [
            {
              id: 'specter-sdk-installed',
              label: 'Enable Specter tracking',
              required: false,
              complete: false,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['specter'],
        readyModules: [],
      },
    };

    const checklist = mapFt1Checklist(readinessSnapshot as any);

    expect(checklist.modules).toHaveLength(1);

    const specter = checklist.modules[0];

    expect(specter.moduleId).toBe('specter');
    expect(specter.title).toBe('Customer & Conversion (Specter)');
    expect(specter.tasks).toHaveLength(1);

    expect(specter.tasks[0]).toEqual({
      id: 'specter-sdk-installed',
      label: 'Enable Specter tracking',
      completed: false,
    });
  });

  it('marks checklist tasks as completed when backend task is complete', () => {
    const readinessSnapshot = {
      shopId: 1,
      modules: [
        {
          moduleId: 'specter',
          displayName: 'Customer & Conversion (Specter)',
          isReady: false,
          signals: [],
          tasks: [
            {
              id: 'specter-sdk-installed',
              label: 'Enable Specter tracking',
              required: false,
              complete: true,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['specter'],
        readyModules: [],
      },
    };

    const checklist = mapFt1Checklist(readinessSnapshot as any);

    expect(checklist.modules[0].tasks[0].completed).toBe(true);
  });

  it('includes multiple modules when present in readiness snapshot', () => {
    const readinessSnapshot = {
      shopId: 1,
      modules: [
        {
          moduleId: 'order-nexus',
          displayName: 'Orders & Profitability',
          isReady: false,
          signals: [],
          tasks: [
            {
              id: 'orderNexus.reviewProfitAutopsy',
              label: 'Review your first Profit Autopsy',
              required: false,
              complete: false,
            },
          ],
        },
        {
          moduleId: 'specter',
          displayName: 'Customer & Conversion (Specter)',
          isReady: false,
          signals: [],
          tasks: [
            {
              id: 'specter-sdk-installed',
              label: 'Enable Specter tracking',
              required: false,
              complete: false,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['order-nexus', 'specter'],
        readyModules: [],
      },
    };

    const checklist = mapFt1Checklist(readinessSnapshot as any);

    expect(checklist.modules.map(m => m.moduleId)).toEqual([
      'order-nexus',
      'specter',
    ]);
  });
});
// apps/frontend/src/hooks/useActivationChecklist.ts
//
// T5 — onboarding activation checklist hook.
// Assembles 5 checklist items from two endpoints:
//   1. GET /api/v1/onboarding/readiness  — items 1–3
//   2. GET /api/v1/user-state/activation-events — items 4–5
//
// See docs/playbooks/onboarding-progressive-disclosure-playbook.md §2 Layer 1.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from '../api/axiosConfig';

export interface ChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  /** Tier 2 ghost pill CTA route — undefined when item has no navigation */
  actionRoute?: string;
}

interface ReadinessResponse {
  modules: Array<{
    moduleId: string;
    tasks: Array<{ id: string; complete: boolean }>;
  }>;
}

interface ActivationEventsResponse {
  wave_released: boolean;
  brief_exported: boolean;
}

function findTask(modules: ReadinessResponse['modules'], moduleId: string, taskId: string): boolean {
  return modules
    .find(m => m.moduleId === moduleId)
    ?.tasks.find(t => t.id === taskId)
    ?.complete ?? false;
}

export function useActivationChecklist() {
  const readiness = useQuery<ReadinessResponse>({
    queryKey: ['onboarding', 'readiness'],
    queryFn: async () => (await axiosInstance.get('/api/v1/onboarding/readiness')).data,
    staleTime: 60_000,
  });

  const events = useQuery<ActivationEventsResponse>({
    queryKey: ['user-state', 'activation-events'],
    queryFn: async () => (await axiosInstance.get('/api/v1/user-state/activation-events')).data,
    staleTime: 30_000,
  });

  const modules = readiness.data?.modules ?? [];

  const items: ChecklistItem[] = [
    {
      key:          'connect-store',
      label:        'Connect your store',
      complete:     findTask(modules, 'platform', 'connect-store'),
    },
    {
      key:          'complete-sync',
      label:        'Complete your first sync',
      complete:     findTask(modules, 'platform', 'complete-sync'),
    },
    {
      key:          'fix-costs',
      label:        'Fix missing product costs',
      complete:     findTask(modules, 'order-nexus', 'orderNexus.resolveMissingCosts'),
      actionRoute:  '/inventory/catalog',
    },
    {
      key:          'wave-released',
      label:        'Release your first wave',
      complete:     events.data?.wave_released ?? false,
      actionRoute:  '/orders/flow',
    },
    {
      key:          'brief-exported',
      label:        'Export your first brief',
      complete:     events.data?.brief_exported ?? false,
      actionRoute:  '/overview',
    },
  ];

  const completedCount = items.filter(i => i.complete).length;
  const allComplete    = completedCount === items.length;

  return {
    items,
    completedCount,
    allComplete,
    isLoading: readiness.isLoading || events.isLoading,
  };
}
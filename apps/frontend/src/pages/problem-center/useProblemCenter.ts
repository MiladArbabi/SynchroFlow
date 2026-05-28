// apps/frontend/src/pages/problem-center/useProblemCenter.ts
//
// Fetches problem_center_tasks — all sources: pick, pack, stow, receive, returns.
// Native ProblemTask type — no legacy PickException mapping.
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { ProblemCenterData } from '@lasyncro/problem-center';

export function useProblemCenter() {
  return useQuery<ProblemCenterData>({
    queryKey: ['problem-center'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/problem-center');
      const raw = data.problem_tasks ?? [];
      const tasks = raw.map((t: {
        problem_task_id: string;
        status: 'open' | 'investigating' | 'resolved' | 'discarded' | 'returned_to_supplier';
        source: 'pick' | 'pack' | 'stow' | 'receive' | 'returns';
        exception_type: string;
        quantity: number;
        notes: string | null;
        problem_bin_location: string | null;
        created_at: string;
        variant_title: string | null;
        sku: string | null;
      }) => ({
        problem_task_id:      t.problem_task_id,
        lasyncro_variant_id:  t.problem_task_id, // variant_id not in GET response — add to backend if needed
        exception_type:       t.exception_type,
        source:               t.source,
        quantity:             t.quantity,
        prob_label:           t.notes,           // notes column stores PROB-1-0001 label
        problem_bin_location: t.problem_bin_location,
        status:               t.status,
        created_at:           t.created_at,
        variant_title:        t.variant_title,
        sku:                  t.sku,
      }));
      return {
        tasks,
        total_unresolved: tasks.filter((t: { status: string }) =>
          t.status === 'open' || t.status === 'investigating'
        ).length,
      };
    },
  });
}
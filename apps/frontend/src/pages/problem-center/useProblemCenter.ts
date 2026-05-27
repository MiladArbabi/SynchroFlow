// apps/frontend/src/pages/problem-center/useProblemCenter.ts
//
// Fetches problem_center_tasks — all sources: pick, pack, stow, receive.
// Maps backend shape to ProblemCenterData contract expected by module.
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { ProblemCenterData } from '@lasyncro/problem-center';

type RawTask = {
  problem_task_id: string;
  status: string;
  source: string;
  exception_type: string;
  quantity: number;
  problem_bin_location: string | null;
  created_at: string;
  variant_title: string | null;
  sku: string | null;
};

export function useProblemCenter() {
  return useQuery<ProblemCenterData>({
    queryKey: ['problem-center'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/problem-center');
      const tasks: RawTask[] = data.problem_tasks ?? [];
      const exceptions = tasks.map((t) => ({
        // Map problem_center_tasks shape → PickException contract
        pick_exception_id:  t.problem_task_id,
        pick_batch_id:      t.problem_bin_location ?? t.problem_task_id,
        lasyncro_line_item_id: t.problem_task_id,
        lasyncro_variant_id:   t.problem_task_id,
        exception_type:     t.exception_type,
        stage:              t.source as 'pick' | 'pack' | 'stow' | 'receive',
        quantity_required:  t.quantity,
        quantity_found:     0, // problem_center_tasks has no found qty — 0 signals unresolved
        raised_by:          0,
        raised_at:          t.created_at,
        resolved:           t.status === 'resolved' || t.status === 'discarded' || t.status === 'returned_to_supplier',
        resolved_by:        null,
        resolved_at:        null,
        resolution_note:    null,
        variant_title:      t.variant_title,
        sku:                t.sku,
        batch_short_id:     t.problem_bin_location ?? undefined,
      }));
      return {
        exceptions,
        total_unresolved: exceptions.filter(e => !e.resolved).length,
      };
    },
  });
}
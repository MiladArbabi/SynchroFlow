import { Knex } from 'knex';

/**
 * STOW-COMPLETE-01 — track units actually placed per stow task
 * ------------------------------------------------------------
 * confirmStow (stow.service.ts §5) set status='completed' on every call,
 * ignoring quantityPlaced entirely. A partial placement therefore closed
 * the task and left the remaining units at status='received' with no open
 * work item — which is why StowSessionPage had to force the operator
 * through the shortfall-exception dialog before confirming. An operator
 * splitting one receipt across two bins had to file a false
 * 'Item missing' exception to represent a correct physical action
 * (STOW-SPLIT-01).
 *
 * Completion cannot be derived from existing schema:
 *   - stow_tasks is the only stow table; no link table exists
 *   - inventory_units carries no stow-task reference
 *   - inventory_movements reference_id is the unit (STOW-MOVEMENT-ID-01),
 *     and the originating task survives only inside an unqueryable
 *     uuidv5 hash
 *   - counting stowed units at the destination is not task-scoped: units
 *     placed there by an earlier task would inflate the count
 *
 * An explicit counter is therefore authoritative rather than inferred.
 * DEFAULT 0 is correct for existing rows: every task in flight today was
 * completed in a single confirm, and completed/cancelled rows are never
 * re-read for completion.
 *
 * NOT addressed here: httpAssignStowLocation (wms.controller.ts:1671,
 * :1709) still requires status='pending', so a task kept open cannot yet
 * have its destination changed. That predicate belongs to STOW-SPLIT-01,
 * which introduces multi-bin placement.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.stow_tasks
      ADD COLUMN quantity_placed INTEGER NOT NULL DEFAULT 0
  `);

  await knex.raw(`
    ALTER TABLE public.stow_tasks
      ADD CONSTRAINT stow_tasks_quantity_placed_check
      CHECK (quantity_placed >= 0 AND quantity_placed <= quantity)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.stow_tasks
      DROP CONSTRAINT IF EXISTS stow_tasks_quantity_placed_check
  `);

  await knex.raw(`
    ALTER TABLE public.stow_tasks
      DROP COLUMN IF EXISTS quantity_placed
  `);
}
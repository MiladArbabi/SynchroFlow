import type { Knex } from "knex";

export async function up(): Promise<void> {
  /**
   * CANONICAL LAYER REMOVAL DISABLED (DEV STABILIZATION)
   * -----------------------------------------------------
   * canonical_orders is still required by:
   * - sync.worker
   * - onboarding readiness
   * - multiple FT evaluators
   *
   * This migration is intentionally neutralized.
   */
}

export async function down(): Promise<void> {}
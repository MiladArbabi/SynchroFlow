import { withTenant } from "@lasyncro/backend-core/db.js";
import { EpistemicValue } from "../../../../packages/epistemic/dist/epistemic.js";
import { buildFinancesFacts } from "./finances-facts/FinancesFacts.service.js";
import { buildFinancesFtep } from "./finances-ftep/FinancesFtep.service.js";
import { buildFinancesIntelligence } from "./finances-intelligence/FinancesIntelligence.service.js";


interface GetFinancesFt2SnapshotInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * Finances FT2 Provider
 * --------------------
 * Canonical FT2 snapshot builder.
 *
 * Strict pipeline:
 * Facts → Intelligence → FTEP
 *
 * No logic.
 * No mutation.
 * No interpretation.
 */
export async function getFinancesFt2Snapshot(
  input: GetFinancesFt2SnapshotInput & {
    epistemic?: {
      revenue?: EpistemicValue<number>;
      netResult?: EpistemicValue<number>;
    };
  }
) {
  // withTenant sets SET LOCAL app.current_tenant — required for all strict RLS tables
  const facts = await withTenant(input.shopId, (trx) => buildFinancesFacts(input, trx));
  const intelligence = buildFinancesIntelligence(facts);

  return buildFinancesFtep({
    facts,
    intelligence,
    epistemic: input.epistemic,
  });
}
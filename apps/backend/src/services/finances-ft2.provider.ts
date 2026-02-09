import { buildFinancesFacts } from 'api-src/services/finances-facts';
import { buildFinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';
import { buildFinancesFtep } from 'api-src/services/finances-ftep';
import { EpistemicValue } from 'packages/epistemic';

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
  const facts = await buildFinancesFacts(input);
  const intelligence = buildFinancesIntelligence(facts);

  return buildFinancesFtep({
    facts,
    intelligence,
    epistemic: input.epistemic,
  });
}
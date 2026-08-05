import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { projectionContracts } from './projectionContracts.js';

export async function validateProjectionContracts() {

  for (const contract of projectionContracts) {

    const columns = await systemQuery(db(contract.table).columnInfo());

    const missing = contract.requiredColumns.filter(
      (c) => !columns[c]
    );

    if (missing.length > 0) {

      console.error(
        '[ProjectionContractRegistry]',
        contract.projection,
        'table:',
        contract.table,
        'missing columns:',
        missing
      );

      if (process.env.NODE_ENV !== 'production') {
        throw new Error(
          `Projection contract violation: ${contract.projection} missing ${missing.join(', ')}`
        );
      }
    }

    console.debug(
      '[ProjectionContractRegistry]',
      contract.projection,
      'verified'
    );
  }

}

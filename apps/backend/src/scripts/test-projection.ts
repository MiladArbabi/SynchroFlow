import db from '@lasyncro/backend-core/db.js';
import { LifecycleProjectionService } from '../services/lifecycle-projection.service.js';

async function run() {
  const userId = 3;
  const shopId = 2;

  await db.transaction(async trx => {
    await LifecycleProjectionService.projectForMembership(
      { shopId, userId },
      trx
    );
  });

  console.log('Projection executed.');
  process.exit(0);
}

run();

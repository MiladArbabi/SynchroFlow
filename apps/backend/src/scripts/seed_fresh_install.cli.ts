/**
 * CLI wrapper for the fresh-install seeder.
 * Usage: npx tsx apps/backend/src/scripts/seed_fresh_install.cli.ts <shopId>
 */
import { seedFreshInstall } from './seed_fresh_install.js';

const shopId = Number(process.argv[2]);

if (!Number.isInteger(shopId) || shopId <= 0) {
  console.error('Usage: seed_fresh_install.cli.ts <shopId>');
  process.exit(1);
}

seedFreshInstall(shopId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FRESH_INSTALL_SEED_FAILED]', err);
    process.exit(1);
  });
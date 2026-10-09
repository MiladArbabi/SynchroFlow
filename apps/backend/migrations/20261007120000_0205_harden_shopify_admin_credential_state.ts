import type { Knex } from 'knex';

/** SHOP-REVIEW-AUTH-01 ARCH-05 — business state authority only. */
export async function up(knex: Knex): Promise<void> {
  // Keep validation/backfill/schema hardening stable against concurrent writers.
  await knex.raw(`LOCK TABLE public.shopify_admin_credentials IN ACCESS EXCLUSIVE MODE`);
  // Fail closed if the migration role cannot inspect all rows under FORCE RLS.
  // This transaction-local setting does not change table policies or FORCE RLS.
  await knex.raw(`SET LOCAL row_security = off`);

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.shopify_admin_credentials
        WHERE credential_state IS NOT NULL
          AND credential_state NOT IN ('ACTIVE', 'REAUTH_REQUIRED')
      ) THEN
        RAISE EXCEPTION
          '0205 refuses unknown non-null Shopify credential states';
      END IF;
    END;
    $$;

    UPDATE public.shopify_admin_credentials
      SET credential_state = 'ACTIVE'
      WHERE credential_state IS NULL;

    ALTER TABLE public.shopify_admin_credentials
      ALTER COLUMN credential_state SET DEFAULT 'ACTIVE',
      ALTER COLUMN credential_state SET NOT NULL,
      ADD CONSTRAINT shopify_admin_credentials_credential_state_check
        CHECK (credential_state IN ('ACTIVE', 'REAUTH_REQUIRED'));
  `);
}

export async function down(_knex: Knex): Promise<void> {
  throw new Error(
    '0205 is forward-only: credential lifecycle state authority must not be weakened'
  );
}

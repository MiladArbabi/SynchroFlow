// apps/backend/migrations/20260108144116_relax_shop_contact_email_uniqueness.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'shops_contact_email_unique'
      ) THEN
        ALTER TABLE shops DROP CONSTRAINT shops_contact_email_unique;
      END IF;
    END
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'shops_contact_email_unique'
      ) THEN
        ALTER TABLE shops ADD CONSTRAINT shops_contact_email_unique UNIQUE (contact_email);
      END IF;
    END
    $$;
  `);
}
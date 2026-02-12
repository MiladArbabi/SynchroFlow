import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_refund_execution_status_monotonic()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        RETURN NEW;
      END IF;

      IF NEW.execution_status = OLD.execution_status THEN
        RETURN NEW;
      END IF;

      IF NEW.execution_status < OLD.execution_status THEN
        RAISE EXCEPTION
          'Illegal refund_execution_status transition: % → %',
          OLD.execution_status,
          NEW.execution_status;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_enforce_refund_execution_status_monotonic
    ON refund_executions;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_enforce_refund_execution_status_monotonic
    BEFORE UPDATE ON refund_executions
    FOR EACH ROW
    EXECUTE FUNCTION enforce_refund_execution_status_monotonic();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_enforce_refund_execution_status_monotonic
    ON refund_executions;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS enforce_refund_execution_status_monotonic();
  `);
}
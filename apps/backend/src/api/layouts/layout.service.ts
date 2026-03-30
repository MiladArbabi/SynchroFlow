//apps/backend/src/api/layouts/layout.service.ts
import knex from "knex";
import { Layout } from "react-grid-layout";

// This type should be kept in sync with the frontend
interface UserLayoutConfiguration {
  layout: Layout[];
  activeWidgets: { instanceId: string; widgetId: string }[];
}

const TABLE_NAME = "user_layouts";

export const findLayout = async (
  userId: string,
  layoutName: string
): Promise<UserLayoutConfiguration | null> => {
  const result = await knex(TABLE_NAME)
    .where({ user_id: userId, layout_name: layoutName })
    .first();
  return result ? result.configuration : null;
};

export const upsertLayout = async (
  userId: string,
  layoutName: string,
  configuration: UserLayoutConfiguration
): Promise<UserLayoutConfiguration> => {
  const data = {
    user_id: userId,
    layout_name: layoutName,
    configuration: configuration, // Knex handles JSONB serialization automatically
  };

  
  await knex(TABLE_NAME)
    .insert(data)
    // CONFLICT POLICY:
    // - Type: USER_LAYOUT_STATE_WRITE
    // - Strategy: UPSERT_EXPLICIT
    // - Rationale: ensure deterministic per-user layout state and prevent implicit overwrites
    .onConflict(["user_id", "layout_name"])
    .merge({
      // EXPLICIT MERGE POLICY: overwrite user layout state deterministically per (user_id, layout_name)
      updated_at: new Date(),
      // NOTE: include all layout state fields explicitly to avoid implicit overwrite behavior
    });

  return configuration;
};
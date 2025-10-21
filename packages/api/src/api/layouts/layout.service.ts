//packages/api/src/api/layouts/layout.service.ts
import knex from "../../db";
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
  console.log(`[DEBUG] findLayout called for user: ${userId}, layout: ${layoutName}`);
  const result = await knex(TABLE_NAME)
    .where({ user_id: userId, layout_name: layoutName })
    .first();
    console.log(`[DEBUG] findLayout result: ${result ? 'Found' : 'Not Found'}`);
  return result ? result.configuration : null;
};

export const upsertLayout = async (
  userId: string,
  layoutName: string,
  configuration: UserLayoutConfiguration
): Promise<UserLayoutConfiguration> => {
  console.log(`[DEBUG] upsertLayout called for user: ${userId}, layout: ${layoutName}`);
  const data = {
    user_id: userId,
    layout_name: layoutName,
    configuration: configuration, // Knex handles JSONB serialization automatically
  };

  console.log(`[DEBUG] upsertLayout data:`, data); // Log the data being inserted/merged
  console.log(`[DEBUG] Attempting knex upsert operation...`);
  await knex(TABLE_NAME)
    .insert(data)
    .onConflict(["user_id", "layout_name"])
    .merge();

  console.log(`[DEBUG] upsertLayout successful for user: ${userId}, layout: ${layoutName}`);
  return configuration;
};
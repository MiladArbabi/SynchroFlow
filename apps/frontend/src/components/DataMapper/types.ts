// apps/frontend/src/components/DataMapper/types.ts
export interface MappingRule {
  id: number;
  shop_id: number;
  source_platform: string;
  source_field_path: string;
  target_field_path: string;
  created_at: string;
  updated_at: string;
}
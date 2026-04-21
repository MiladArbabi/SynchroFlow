// apps/frontend/src/api/permissions.ts
import { axiosInstance } from './axiosConfig';

export type Role = 'owner' | 'admin' | 'operator';

export interface RolePermission {
  granted: boolean;
  locked: boolean;
}

export interface ActionPermission {
  action: string;
  domain: string;
  label: string;
  permissions: Record<Role, RolePermission>;
}

export interface PermissionMatrix {
  actions: ActionPermission[];
}

export interface PermissionUpdate {
  action: string;
  role: Role;
  granted: boolean;
}

export interface UpdateResult {
  applied: number;
  rejected: { update: PermissionUpdate; reason: string }[];
}

export async function getPermissions(): Promise<PermissionMatrix> {
  const { data } = await axiosInstance.get('/api/v1/settings/permissions');
  return data as PermissionMatrix;
}

export async function updatePermissions(updates: PermissionUpdate[]): Promise<UpdateResult> {
  const { data } = await axiosInstance.patch('/api/v1/settings/permissions', { updates });
  return data as UpdateResult;
}
// apps/frontend/src/pages/members/useMembers.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type MemberRole = 'owner' | 'admin' | 'operator';

export type Member = {
  user_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: MemberRole;
  member_since: string;
};

export type MembersResponse = {
  members: Member[];
};

/**
 * useMembers
 * ----------
 * Fetches all active shop members.
 * Owner/admin only — backend enforces via requireRole.
 */
export function useMembers() {
  return useQuery<MembersResponse>({
    queryKey: ['members'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/members');
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

/**
 * useUpdateMemberRole
 * -------------------
 * Owner/admin updates a member's role.
 * Invalidates members cache on success.
 */
export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { userId: number; role: MemberRole }>({
    mutationFn: async ({ userId, role }) => {
      await axiosInstance.patch(`/api/v1/members/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });
}

/**
 * useCreateMember
 * ---------------
 * Owner/admin creates a new shop member.
 * Backend sends invite email with temporary credentials.
 * Invalidates members cache on success.
 */
export function useCreateMember() {
  const queryClient = useQueryClient();
  return useMutation<
    { user_id: number; email: string; role: MemberRole },
    Error,
    { email: string; first_name: string; last_name: string; role: MemberRole }
  >({
    mutationFn: async (body) => {
      const { data } = await axiosInstance.post('/api/v1/members', body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });
}
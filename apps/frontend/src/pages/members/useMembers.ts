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

// ─── MEMBER DETAIL ────────────────────────────────────────────

export type ScheduleRow = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  effective_from: string;
};

export type MemberDetailResponse = {
  identity: {
    user_id: number;
    email: string;
    first_name: string | null;
    last_name: string | null;
    role: MemberRole;
    member_since: string;
  };
  cost_and_shift?: {
    hourly_cost: number | null;
    display_hidden: boolean;
  };
  notes?: string | null;
  performance: {
    uph_30d: number | null;
    accuracy_30d_pct: number | null;
    exception_count_30d: number;
    scan_source_mix: Record<string, number>;
  };
  recent_activity: {
    pick_batch_id: string;
    pick_claimed_at: string;
    pick_completed_at: string | null;
    units_picked: number;
    total_units: number;
    duration_seconds: number | null;
    exception_count: number;
  }[];
};

export function useMemberDetail(userId: number) {
  return useQuery<MemberDetailResponse>({
    queryKey: ['members', userId, 'detail'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(`/api/v1/members/${userId}`);
      return data;
    },
    enabled: userId > 0,
    placeholderData: (prev) => prev,
  });
}

export function usePatchMemberDetail() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { userId: number; hourly_cost?: number | null; display_hidden?: boolean; owner_notes?: string | null }
  >({
    mutationFn: async ({ userId, ...body }) => {
      await axiosInstance.patch(`/api/v1/members/${userId}`, body);
    },
    onSuccess: (_d, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['members', userId, 'detail'] });
    },
  });
}

export function useMemberSchedule(userId: number) {
  return useQuery<{ user_id: number; schedule: ScheduleRow[] }>({
    queryKey: ['members', userId, 'schedule'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(`/api/v1/members/${userId}/schedule`);
      return data;
    },
    enabled: userId > 0,
  });
}

export function usePutMemberSchedule() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { userId: number; schedule: { weekday: number; start_time: string; end_time: string }[] }
  >
  ({
    mutationFn: async ({ userId, schedule }) => {
      await axiosInstance.put(`/api/v1/members/${userId}/schedule`, { schedule });
    },
    onSuccess: (_d, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['members', userId, 'schedule'] });
    },
  });
}
// apps/frontend/src/pages/returns/useReturnScan.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface ReturnScanResult {
  lasyncroOrderId: string;
  externalOrderId: string | null;
  resolutionMethod: 'lso' | 'lsu';
  returnJobId: string;
  status: string;
  isNew: boolean;
  claimedByOther: boolean;
}

function extractErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? 'Scan failed — try again';
}

export function useReturnScan() {
  return useMutation<ReturnScanResult, Error, string>({
    mutationFn: async (scannedValue: string) => {
      try {
        const { data } = await axiosInstance.post('/api/v1/wms/returns/scan', { scanned_value: scannedValue });
        return data as ReturnScanResult;
      } catch (err: unknown) {
        throw new Error(extractErrorMessage(err));
      }
    },
  });
}

export interface AddReturnLineInput {
  scannedValue: string;
  quantityReceived: number;
  itemCondition: 'resellable' | 'repackable' | 'damaged' | 'unsellable';
  conditionNotes?: string;
}

export function useAddReturnLine(returnJobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, AddReturnLineInput>({
    mutationFn: async (input: AddReturnLineInput) => {
      try {
        await axiosInstance.post(`/api/v1/modules/returns/jobs/${returnJobId}/lines`, {
          scanned_value: input.scannedValue,
          quantity_received: input.quantityReceived,
          item_condition: input.itemCondition,
          condition_notes: input.conditionNotes,
        });
      } catch (err: unknown) {
        throw new Error(extractErrorMessage(err));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['return-job', returnJobId] });
    },
  });
}

export interface UpdateReturnLineInput {
  lineId: string;
  itemCondition: 'resellable' | 'repackable' | 'damaged' | 'unsellable';
  quantityReceived: number;
  conditionNotes?: string;
}

export function useProcessReturnLine(returnJobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, UpdateReturnLineInput>({
    mutationFn: async (input: UpdateReturnLineInput) => {
      try {
        await axiosInstance.patch(`/api/v1/modules/returns/jobs/${returnJobId}/lines/${input.lineId}`, {
          item_condition: input.itemCondition,
          quantity_received: input.quantityReceived,
          condition_notes: input.conditionNotes,
        });
      } catch (err: unknown) {
        throw new Error(extractErrorMessage(err));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['return-job', returnJobId] });
    },
  });
}

export interface CompleteReturnJobInput {
  returnReason?: string;
  returnNotes?: string;
}

export function useCompleteReturnJob(returnJobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, CompleteReturnJobInput>({
    mutationFn: async (input: CompleteReturnJobInput) => {
      try {
        await axiosInstance.post(`/api/v1/modules/returns/jobs/${returnJobId}/complete`, {
          return_reason: input.returnReason,
          return_notes: input.returnNotes,
        });
      } catch (err: unknown) {
        throw new Error(extractErrorMessage(err));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['return-job', returnJobId] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
    },
  });
}